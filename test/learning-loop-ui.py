import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from ui_controls import select_space

BASE = 'http://127.0.0.1:3100'
fixture = json.loads(Path('data/iteration26-fixture.json').read_text(encoding='utf-8'))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1365, 'height': 900})
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    select_space(page, fixture['spaceId'])
    expect(page.get_by_role('heading', name='今天从这里开始')).to_be_visible()
    expect(page.get_by_role('button', name='开始到期复习')).to_be_visible()
    page.get_by_text('学习依据', exact=False).first.click()
    expect(page.get_by_text('自评不替代练习判题。', exact=False).first).to_be_visible()

    # 暂缓只影响会话队列，不改 due 或复习次数。
    before = page.request.get(f'{BASE}/api/cards?spaceId={fixture["spaceId"]}&all=1').json()['cards']
    page.get_by_role('button', name='开始到期复习').click()
    dialog = page.get_by_role('dialog', name='复习', exact=True)
    expect(dialog.get_by_role('button', name='稍后再练')).to_be_visible()
    initial_due = [c for c in before if c['due'] <= __import__('datetime').date.today().isoformat()]
    for _ in initial_due:
        dialog.get_by_role('button', name='稍后再练').click()
    expect(dialog.get_by_text(f'暂缓 {len(initial_due)} 张', exact=False)).to_be_visible()
    dialog.get_by_role('button', name='完成', exact=True).click()
    after = page.request.get(f'{BASE}/api/cards?spaceId={fixture["spaceId"]}&all=1').json()['cards']
    assert [(c['id'], c['due'], c['repetitions']) for c in before] == [(c['id'], c['due'], c['repetitions']) for c in after]

    # 刷新失败保留旧地图，并能原位恢复。
    state = {'fail': True}
    def map_route(route):
        if state['fail']:
            route.fulfill(status=503, json={'error': '验收模拟地图失败'})
        else:
            route.continue_()
    page.route(f'**/api/spaces/{fixture["spaceId"]}/map', map_route)
    page.get_by_role('button', name='开始到期复习').click()
    page.get_by_role('dialog', name='复习', exact=True).get_by_role('button', name='退出', exact=True).click()
    expect(page.get_by_text('验收模拟地图失败', exact=False)).to_be_visible()
    expect(page.get_by_role('heading', name='今天从这里开始')).to_be_visible()
    state['fail'] = False
    page.get_by_role('button', name='重试加载地图').click()
    expect(page.get_by_text('验收模拟地图失败', exact=False)).to_have_count(0)
    page.unroute(f'**/api/spaces/{fixture["spaceId"]}/map', map_route)

    # 清到期后直接进入路线下一概念，实际作答后转为待巩固、再定位补弱。
    for c in before:
        page.request.post(f'{BASE}/api/cards/{c["id"]}/review', data={'grade': 'easy'})
    page.reload()
    page.get_by_role('button', name='继续学习', exact=True).click()
    expect(page.get_by_role('button', name='🔖 制成复习卡', exact=True)).to_be_visible()
    with page.expect_response(lambda r: '/api/attempts' in r.url and r.request.method == 'POST'):
        page.get_by_role('button', name='后进先出', exact=True).click()
    expect(page.get_by_role('button', name='栈 待巩固', exact=False)).to_be_visible()
    docs = page.request.get(f'{BASE}/api/docs?spaceId={fixture["spaceId"]}').json()['docs']
    for _ in range(2):
        page.request.post(f'{BASE}/api/attempts', data={'docId': docs[0]['id'], 'blockType': 'quiz', 'correct': False})
    page.reload()
    page.get_by_role('button', name='开始补弱', exact=True).click()
    expect(page.get_by_role('button', name='🔖 制成复习卡', exact=True)).to_be_visible()

    # 原路线保留，解除模拟失败后通过本地模型原位重试。
    page.route('**/roadmap', lambda route: route.fulfill(status=503, json={'error': '验收模拟编排失败'}))
    page.get_by_role('button', name='重新生成', exact=True).click()
    expect(page.get_by_text('验收模拟编排失败', exact=False)).to_be_visible()
    expect(page.get_by_text('线性结构', exact=True)).to_be_visible()
    expect(page.get_by_role('button', name='重试编排')).to_be_visible()
    page.unroute('**/roadmap')
    page.get_by_role('button', name='重试编排').click()
    expect(page.get_by_text('验收模拟编排失败', exact=False)).to_have_count(0)
    expect(page.get_by_text('线性结构', exact=True)).to_be_visible()

    # 自测退出和整页刷新后题序、已提交答案均保留。
    page.get_by_role('button', name='测验', exact=True).click()
    exam = page.get_by_role('dialog', name='综合自测', exact=True)
    exam.get_by_role('button', name='开始新自测').click()
    expect(exam.get_by_role('button', name='显示答案（空格）')).to_be_visible()
    exam.get_by_role('button', name='显示答案（空格）').click()
    with page.expect_response(lambda r: '/answers' in r.url and r.request.method == 'POST'):
        exam.get_by_role('button', name='忘记', exact=False).click()
    expect(exam.get_by_text('第 2 题', exact=False)).to_be_visible()
    exam.get_by_role('button', name='保存并退出').click()
    page.reload()
    expect(page.get_by_role('heading', name='今天从这里开始')).to_be_visible()
    page.get_by_role('button', name='测验', exact=True).click()
    expect(exam.get_by_text('第 2 题', exact=False)).to_be_visible()
    exam.get_by_role('button', name='显示答案（空格）').click()
    with page.expect_response(lambda r: '/answers' in r.url and r.request.method == 'POST'):
        exam.get_by_role('button', name='记得', exact=False).click()
    expect(exam.get_by_text('报告已保存。', exact=False)).to_be_visible()
    exam.get_by_text('本次作答明细', exact=True).click()
    expect(exam.get_by_text('本次自评：忘记', exact=True)).to_be_visible()
    exam.get_by_role('button', name='复习本次忘记的卡').click()
    review = page.get_by_role('dialog', name='复习', exact=True)
    expect(review.get_by_text('1 张卡', exact=False)).to_be_visible()
    review.get_by_role('button', name='稍后再练').click()
    review.get_by_role('button', name='完成', exact=True).click()
    page.get_by_role('button', name='测验', exact=True).click()
    exam.get_by_role('button', name='查看报告', exact=False).first.click()
    expect(exam.get_by_text('报告已保存。', exact=False)).to_be_visible()
    if exam.get_by_role('button', name='相关讲解').count():
        exam.get_by_role('button', name='相关讲解').first.click()
        page.get_by_text('生成时的资料依据', exact=True).click()
        expect(page.get_by_text('后续资料修改不会改写此快照。', exact=False)).to_be_visible()
    else:
        exam.get_by_role('button', name='关闭报告').click()

    # 解析正文搜索、保存失败留草稿、版本检查后保存概念。
    page.get_by_title('批量导入文档资料，生成讲解时作为事实依据').click()
    page.get_by_role('button', name='查看与纠错', exact=True).click()
    editor = page.get_by_role('dialog', name='查看与纠正资料')
    expect(editor.get_by_role('textbox', name='解析正文（纯文本 / Markdown）', exact=True)).to_be_visible()
    editor.get_by_label('搜索解析正文').fill('队列')
    expect(editor.get_by_text('匹配 1 行')).to_be_visible()
    editor.get_by_role('textbox', name='解析正文（纯文本 / Markdown）', exact=True).fill('浏览器修正：队列从队头移除。')
    page.route(f'**/api/sources/{fixture["sourceId"]}', lambda route: route.fulfill(status=503, json={'error': '验收模拟保存失败'}) if route.request.method == 'PATCH' else route.continue_())
    editor.get_by_role('button', name='保存正文并清空旧概念').click()
    expect(editor.get_by_text('验收模拟保存失败', exact=False)).to_be_visible()
    expect(editor.get_by_role('textbox', name='解析正文（纯文本 / Markdown）', exact=True)).to_have_value('浏览器修正：队列从队头移除。')
    page.unroute(f'**/api/sources/{fixture["sourceId"]}')
    editor.get_by_role('button', name='保存正文并清空旧概念').click()
    expect(editor.get_by_text('正文已保存', exact=False)).to_be_visible()
    editor.get_by_role('textbox', name='人工确认概念', exact=False).fill('队列\n人工补充概念')
    editor.get_by_role('button', name='保存概念', exact=True).click()
    expect(editor.get_by_text('概念已保存', exact=False)).to_be_visible()
    editor.get_by_role('button', name='关闭', exact=True).click()
    page.get_by_role('button', name='关闭资料', exact=True).click()
    expect(page.get_by_role('button', name='关闭资料', exact=True)).to_have_count(0)
    expect(page.get_by_role('button', name='人工补充概念 未学 1 份资料提及', exact=True)).to_be_visible()
    page.screenshot(path='data/iteration26-desktop.png', full_page=True)

    # 新空间可直达资料；窄屏没有整体横向滚动。
    select_space(page, fixture['emptyId'])
    page.get_by_role('button', name='导入第一份资料').click()
    expect(page.get_by_role('button', name='导入文件')).to_be_visible()
    page.get_by_role('button', name='关闭资料', exact=True).click()
    expect(page.get_by_role('button', name='关闭资料', exact=True)).to_have_count(0)
    select_space(page, fixture['spaceId'])
    expect(page.get_by_role('heading', name='今天从这里开始')).to_be_visible()
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path='data/iteration26-mobile.png', full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), page.evaluate("[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,text:e.innerText?.slice(0,60),class:e.className}))")
    page.get_by_title('批量导入文档资料，生成讲解时作为事实依据').click()
    page.get_by_role('button', name='查看与纠错', exact=True).click()
    expect(editor).to_be_visible()
    page.keyboard.press('Tab')
    assert editor.evaluate('(el) => el.contains(document.activeElement)'), 'Focus escaped dialog'
    bounds = editor.bounding_box()
    assert bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= 390
    page.screenshot(path='data/iteration26-mobile-editor.png', full_page=True)
    page.keyboard.press('Escape')
    expect(editor).to_have_count(0)
    assert not errors, errors
    print('PASS: browser tasks / recovery / reports / deferred cards / source correction / errors / narrow layout')
    browser.close()
