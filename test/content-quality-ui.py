import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:3100'
f = json.loads(Path('data/iteration27-fixture.json').read_text(encoding='utf-8'))
SPACE_TITLE = '空间：资料/历史/统计按空间分组，选定后显示概念地图'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors, native, deletions = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: (native.append(dialog.message), dialog.dismiss()))
    page.on('request', lambda request: deletions.append(request.url) if request.method == 'DELETE' else None)
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    picker = page.get_by_title(SPACE_TITLE)
    picker.select_option(str(f['spaceId']))
    expect(page.get_by_role('button', name='递归 待练习', exact=False)).to_be_visible()
    expect(page.get_by_role('button', name='练习过 待巩固', exact=False)).to_be_visible()
    expect(page.get_by_text('待练习：已有讲解', exact=False)).to_be_visible()
    # Shared colors are distinct and match the actual status card borders/backgrounds.
    dots = page.locator('span[title] > span.h-2').evaluate_all('(nodes) => nodes.map(n => getComputedStyle(n).backgroundColor)')
    assert len(dots) == 5 and len(set(dots)) == 5, dots
    page.get_by_role('button', name='递归 待练习', exact=False).click()
    expect(page.get_by_role('button', name='🔖 制成复习卡', exact=True)).to_be_visible()
    expect(page.locator('strong').filter(has_text='递与归').first).to_be_visible()
    expect(page.locator('strong').filter(has_text='递归阶段')).to_be_visible()
    expect(page.locator('strong').filter(has_text='所在阶段')).to_be_visible()
    expect(page.locator('pre').filter(has_text='def f(n):')).to_be_visible()
    blank = page.locator('pre').filter(has_text='def jie_cheng')
    expect(blank).to_be_visible()
    assert '\n    if num == 1:' in blank.inner_text()
    assert blank.evaluate('(node) => getComputedStyle(node).whiteSpace') == 'pre'
    expect(page.get_by_text('空1', exact=True).first).to_be_visible()
    # A slider affects both actual plotted series, not just the caption.
    chart = page.locator('figure').filter(has_text='当前递归深度的递与归')
    slider = page.get_by_role('slider')
    slider.focus()
    slider.press('End')
    expect(chart.get_by_text('当前值：8', exact=False)).to_be_visible()
    canvas_before = chart.locator('canvas').first.screenshot()
    slider.press('Home')
    expect(chart.get_by_text('当前值：1', exact=False)).to_be_visible()
    canvas_after = chart.locator('canvas').first.screenshot()
    assert canvas_before != canvas_after
    # Exact legacy auto cards now contain all choices, including resumed sessions.
    page.get_by_role('button', name='📝 测验', exact=True).click()
    exam = page.get_by_role('dialog', name='综合自测')
    count = len(page.request.get(f'{BASE}/api/exams?spaceId={f["spaceId"]}').json()['sessions'][0]['cards'])
    found = False
    for step in range(count):
        if exam.get_by_text('D. 1 层', exact=False).count():
            expect(exam.get_by_text('A. 5 层', exact=True)).to_be_visible()
            found = True
            break
        exam.get_by_role('button', name='显示答案（空格）', exact=True).click()
        with page.expect_response(lambda response: '/answers' in response.url and response.request.method == 'POST'):
            exam.get_by_role('button', name='记得', exact=False).click()
        if step + 1 < count:
            expect(exam.get_by_text(re.compile(rf'第\s*{step + 2}\s*题'))).to_be_visible()
    assert found, 'Missing choices in active exam'
    exam.get_by_role('button', name='保存并退出', exact=True).click()
    # Source draft cancellation retains draft; Escape closes only the confirmation.
    page.get_by_title('批量导入文档资料，生成讲解时作为事实依据').click()
    page.get_by_role('button', name='查看与纠错', exact=True).click()
    editor = page.get_by_role('dialog', name='查看与纠正资料')
    content = editor.get_by_role('textbox', name='解析正文（纯文本 / Markdown）', exact=True)
    content.fill('未保存的验收草稿')
    editor.get_by_role('button', name='关闭', exact=True).click()
    confirm = page.get_by_role('alertdialog')
    expect(confirm).to_be_visible()
    confirm.get_by_role('button', name='取消', exact=True).click()
    expect(content).to_have_value('未保存的验收草稿')
    editor.get_by_role('button', name='关闭', exact=True).click()
    page.keyboard.press('Escape')
    expect(confirm).to_have_count(0)
    expect(editor).to_be_visible()
    editor.get_by_role('button', name='关闭', exact=True).click()
    confirm.get_by_role('button', name='放弃并关闭', exact=True).click()
    expect(editor).to_have_count(0)
    page.get_by_role('button', name='关闭资料', exact=True).click()
    # Cancel/Escape/backdrop never issue a delete or open another confirmation.
    delete_current = page.get_by_title('彻底删除当前空间及其内容')
    for mode in ['cancel', 'escape', 'backdrop']:
        delete_current.click()
        expect(confirm).to_be_visible()
        if mode == 'cancel':
            confirm.get_by_role('button', name='取消', exact=True).click()
        elif mode == 'escape':
            page.keyboard.press('Escape')
        else:
            page.mouse.click(5, 5)
        expect(confirm).to_have_count(0)
        expect(picker).to_have_value(str(f['spaceId']))
    assert not deletions, deletions
    # A nested confirmation is usable on narrow screens and traps focus.
    page.set_viewport_size({'width': 390, 'height': 844})
    delete_current.click()
    page.keyboard.press('Tab')
    assert confirm.evaluate('(node) => node.contains(document.activeElement)')
    bounds = confirm.bounding_box()
    assert bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= 390
    page.screenshot(path='data/iteration27-confirm-mobile.png', full_page=True)
    confirm.get_by_role('button', name='取消', exact=True).click()
    page.set_viewport_size({'width': 1280, 'height': 900})
    # Deep delete failure is visible and can be retried, then sends exactly one request.
    picker.select_option(str(f['deepSpace']))
    page.route(f'**/api/spaces/{f["deepSpace"]}', lambda route: route.fulfill(status=503, json={'error': '验收删除失败'}))
    delete_current.click()
    confirm.get_by_role('button', name='彻底删除空间', exact=True).click()
    expect(page.get_by_text('验收删除失败', exact=False)).to_be_visible()
    page.unroute(f'**/api/spaces/{f["deepSpace"]}')
    before = len(deletions)
    delete_current.click()
    confirm.get_by_role('button', name='彻底删除空间', exact=True).click()
    expect(picker).to_have_value('')
    assert len(deletions) == before + 1 and deletions[-1].endswith(f'/api/spaces/{f["deepSpace"]}')
    assert page.request.get(f'{BASE}/api/docs/{f["deepDoc"]}').status == 404
    picker.select_option(str(f['plainSpace']))
    before = len(deletions)
    delete_current.click()
    expect(confirm.get_by_role('radio')).to_have_count(0)
    confirm.get_by_role('button', name='彻底删除空间', exact=True).click()
    expect(picker).to_have_value('')
    assert len(deletions) == before + 1 and deletions[-1].endswith(f'/api/spaces/{f["plainSpace"]}')
    assert page.request.get(f'{BASE}/api/docs/{f["keepDoc"]}').status == 404
    # An invalid legacy question is explicitly skipped without a grade.
    picker.select_option(str(f['badSpace']))
    page.get_by_role('button', name='📝 测验', exact=True).click()
    expect(exam.get_by_role('button', name='跳过不完整题目')).to_be_visible()
    exam.get_by_role('button', name='跳过不完整题目').click()
    expect(exam.get_by_text('未计分', exact=True)).to_be_visible()
    exam.get_by_role('button', name='关闭报告', exact=True).click()
    picker.select_option(str(f['spaceId']))
    page.get_by_role('button', name='递归 待练习', exact=False).click()
    page.set_viewport_size({'width': 390, 'height': 844})
    expect(blank).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path='data/iteration27-content-mobile.png', full_page=True)
    assert not native, native
    assert not errors, errors
    print('PASS: browser deep deletion/cancellation/retry, draft preservation, Markdown/code layout, chart changes, status colors, resumed choices, invalid-card skip, mobile overflow')
    browser.close()
