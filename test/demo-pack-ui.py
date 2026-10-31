"""先导入演示包，再对隔离验收端口执行桌面只读验收；不产生学习成绩。"""
from playwright.sync_api import sync_playwright, expect
from ui_controls import select_space

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1050}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:3100')
    page.wait_for_load_state('networkidle')
    spaces = page.request.get('http://127.0.0.1:3100/api/spaces').json()['spaces']
    space = next(s for s in spaces if s['name'] == '演示 · 交互学习精选')
    select_space(page, space['id'])
    expect(page.get_by_text('观察参数联动', exact=True)).to_be_visible()
    history = page.get_by_role('button', name='历史讲解', exact=False)
    history.click()
    expect(page.locator('[data-history-root]')).to_have_count(2)
    page.locator('[data-history-root]').get_by_text('正弦波的频率', exact=True).click()
    expect(page.get_by_label('当前讲解版本', exact=True)).to_contain_text('已追加补充')
    slider = page.get_by_role('slider').first
    slider.scroll_into_view_if_needed()
    slider.focus()
    value = slider.input_value()
    slider.press('ArrowRight')
    assert slider.input_value() != value
    page.screenshot(path='data/demo-wave-desktop.png', full_page=True)
    page.get_by_role('button', name='查看原始讲解', exact=True).click()
    expect(page.get_by_text('补充：频率翻倍，周期怎样变化？', exact=True)).to_have_count(0)
    history.click()
    page.locator('[data-history-root]').get_by_text('快速排序：先分区，再递归', exact=True).click()
    expect(page.locator('.diagram-canvas')).to_have_attribute('aria-busy', 'false', timeout=20000)
    expect(page.locator('.react-flow__node')).to_have_count(8)
    diagram = page.get_by_role('figure', name='快速排序的分区与递归流程', exact=True)
    diagram.scroll_into_view_if_needed()
    page.screenshot(path='data/demo-diagram-desktop.png')
    page.get_by_role('group', name='架构图讲解步骤', exact=True).get_by_role('button').nth(1).click()
    expect(page.locator('.diagram-canvas')).to_have_attribute('aria-busy', 'false')
    assert not errors, errors
    browser.close()
print('PASS 演示空间、路线、历史归组、原文/补充、滑块与架构图桌面验收')
