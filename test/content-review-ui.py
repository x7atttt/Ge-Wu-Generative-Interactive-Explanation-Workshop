import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from ui_controls import select_space

BASE = 'http://127.0.0.1:3100'
MODEL = 'http://127.0.0.1:3101'
fixture = json.loads(Path('data/content-review-fixture.json').read_text(encoding='utf-8'))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    select_space(page, fixture['spaceId'])
    page.get_by_role('button', name='联网检索', exact=True).click()
    page.get_by_placeholder('想搞懂什么概念？如：正弦波的频率、英语名词复数、快速排序', exact=True).fill('阶乘内容复核')
    page.request.post(MODEL + '/control', data=json.dumps({'outputs': [fixture['valid']], 'reviews': [{'status': 503}], 'reviewDelay': 2500}))
    generate = page.get_by_role('button', name='生成讲解', exact=True)
    generate.click()
    progress = page.get_by_role('region', name='讲解生成进度', exact=True)
    expect(progress.get_by_role('progressbar')).to_have_attribute('data-stage', 'review')
    expect(progress.get_by_text('正在核对题目与解析', exact=True)).to_be_visible()
    expect(progress.get_by_text('正文生成完成，正在以 low 单独复核算例、答案与解析。', exact=True)).to_be_visible()
    expect(progress.get_by_role('button', name='取消生成', exact=True)).to_be_enabled()
    assert progress.get_by_role('progressbar').get_attribute('aria-valuenow') is None
    expect(page.get_by_text('标准阶乘 factorial(3) = 6。', exact=True)).to_be_visible()
    page.screenshot(path='data/content-review-desktop.png', full_page=True)
    expect(generate).to_be_enabled(timeout=10000)
    expect(progress).to_have_count(0)
    expect(page.get_by_role('heading', name='内容复核验收', exact=True)).to_be_visible()
    assert not errors, errors
    browser.close()
