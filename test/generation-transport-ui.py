import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from ui_controls import select_space

BASE = 'http://127.0.0.1:3100'
MODEL = 'http://127.0.0.1:3101'
f = json.loads(Path('data/generation-transport-fixture.json').read_text(encoding='utf-8'))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1100, 'height': 900}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    select_space(page, f['spaceId'])
    concept = page.get_by_placeholder('想搞懂什么概念？如：正弦波的频率、英语名词复数、快速排序', exact=True)
    concept.fill('连接重试验收')
    page.get_by_role('button', name='联网检索', exact=True).click()
    generate = page.get_by_role('button', name='生成讲解', exact=True)
    page.request.post(MODEL + '/control', data=json.dumps({'faults': [{'status': 503}, {'status': 503}], 'delay': 1400, 'outputs': [f['valid']]}))
    generate.click()
    expect(page.get_by_text('连接暂时异常，正在重新连接（2/2）', exact=True)).to_be_visible(timeout=10000)
    page.screenshot(path='data/generation-retry-desktop.png', full_page=True)
    expect(page.get_by_text('这是重试后完整的讲解。', exact=True)).to_be_visible(timeout=10000)
    expect(generate).to_be_enabled()
    assert len(page.request.get(MODEL + '/state').json()['requests']) == 3

    abandoned = {**f['valid'], 'blocks': [{'type': 'text', 'content': '这段旧预览必须被清空。'}]}
    page.request.post(MODEL + '/control', data=json.dumps({'faults': [{'mode': 'partial', 'text': json.dumps(abandoned, ensure_ascii=False), 'delay': 800}], 'outputs': [f['valid']]}))
    generate.click()
    expect(page.get_by_text('这段旧预览必须被清空。', exact=True)).to_be_visible()
    expect(page.get_by_text('连接暂时异常，正在重新连接（1/2）', exact=True)).to_be_visible()
    expect(page.get_by_text('这段旧预览必须被清空。', exact=True)).to_have_count(0)
    expect(generate).to_be_enabled(timeout=10000)

    page.request.post(MODEL + '/control', data=json.dumps({'delay': 60000, 'outputs': [f['valid'], f['valid']]}))
    generate.click()
    expect(page.get_by_role('button', name='取消生成', exact=True)).to_be_visible()
    for _ in range(100):
        if page.request.get(MODEL + '/state').json()['pending']:
            break
        page.wait_for_timeout(20)
    else:
        raise AssertionError('上游请求未启动')
    page.get_by_role('button', name='取消生成', exact=True).click()
    expect(generate).to_be_enabled()
    generate.click()
    expect(generate).to_be_enabled(timeout=10000)
    expect(page.get_by_text('已有生成/改造进行中，请等它完成', exact=True)).to_have_count(0)
    expect(page.get_by_text('这是重试后完整的讲解。', exact=True)).to_be_visible()

    page.request.post(MODEL + '/control', data=json.dumps({'faults': [{'status': 401}]}))
    generate.click()
    error = page.get_by_role('alert').filter(has_text='LLM 服务返回 401')
    expect(error).to_be_visible()
    page.get_by_role('button', name='关闭错误提示', exact=True).click()
    expect(error).to_have_count(0)
    page.set_viewport_size({'width': 390, 'height': 850})
    page.request.post(MODEL + '/control', data=json.dumps({'faults': [{'status': 503}, {'status': 503}], 'delay': 1400, 'outputs': [f['valid']]}))
    generate.click()
    expect(page.get_by_text('连接暂时异常，正在重新连接（2/2）', exact=True)).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path='data/generation-retry-mobile.png', full_page=True)
    expect(generate).to_be_enabled(timeout=10000)
    page.get_by_role('button', name='追问细节', exact=True).click()
    page.request.post(MODEL + '/control', data=json.dumps({'faults': [{'mode': 'partial', 'text': '废弃回答片段', 'delay': 1000}], 'outputs': ['恢复后的完整回答']}))
    page.get_by_placeholder('如：这题为什么选 B？（📷 / 粘贴 / 拖入截图提问）', exact=True).fill('解释恢复过程')
    page.get_by_role('button', name='追问', exact=True).click()
    expect(page.get_by_text('废弃回答片段', exact=True)).to_be_visible()
    expect(page.get_by_text('恢复后的完整回答', exact=True)).to_be_visible(timeout=10000)
    expect(page.get_by_text('废弃回答片段', exact=True)).to_have_count(0)
    assert not errors, errors
    browser.close()
print('PASS: visible retry count, partial preview reset, immediate restart after cancel, dismissible errors and narrow layout')
