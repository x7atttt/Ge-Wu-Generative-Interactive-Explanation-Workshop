"""桌面统一路由验收，使用隔离验收服务和临时空间。"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from ui_controls import select_space

f = json.loads(Path('data/diagram-effort-fixture.json').read_text(encoding='utf-8'))
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1400}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    page.goto('http://127.0.0.1:3100')
    page.wait_for_load_state('networkidle')
    select_space(page, f['spaceId'])
    page.get_by_role('button', name='历史讲解', exact=False).click()
    page.get_by_text(f['branchDoc']['title'], exact=True).first.click()
    figure = page.get_by_role('figure', name=f['branchDoc']['blocks'][2]['title'], exact=True)
    expect(figure.locator('.react-flow__node-lesson')).to_have_count(6, timeout=20000)
    canvas = figure.locator('.diagram-canvas')
    expect(canvas).to_have_attribute('data-direction', 'TB')
    assert 420 <= canvas.bounding_box()['height'] <= 900
    directions = figure.get_by_role('group', name='架构图排布方向', exact=True)
    geometry = figure.evaluate('''el => {
      const boxes=Object.fromEntries([...el.querySelectorAll('.react-flow__node-lesson')].map(n=>[n.dataset.id,n.getBoundingClientRect().toJSON()]));
      const labels=[...el.querySelectorAll('.diagram-edge-label')].map(n=>n.getBoundingClientRect().toJSON());
      return {boxes,labels,positions:[...el.querySelectorAll('.react-flow__node')].map(n=>[n.dataset.id,n.style.transform])};
    }''')
    boxes, labels = geometry['boxes'], geometry['labels']
    assert boxes['node:left']['x'] < boxes['node:right']['x'], '左右分支按阅读顺序排列'
    assert boxes['node:place']['y'] < boxes['node:left']['y'] < boxes['node:stop']['y']
    assert min(b['width'] / 220 for b in boxes.values()) >= .8, '总览文字保持可读'
    def intersects(a, b):
        return a['x'] < b['x'] + b['width'] - 1 and a['x'] + a['width'] > b['x'] + 1 and a['y'] < b['y'] + b['height'] - 1 and a['y'] + a['height'] > b['y'] + 1
    for i, label in enumerate(labels):
        assert not any(intersects(label, box) for box in boxes.values()), '标签不得盖住节点'
        assert not any(intersects(label, other) for other in labels[i + 1:]), '标签不得互相遮盖'
    figure.scroll_into_view_if_needed()
    figure.screenshot(path='data/diagram-branch-auto-desktop.png')
    figure.get_by_role('button', name='2. 左右递归', exact=True).click()
    expect(figure.locator('path.react-flow__edge-path[style*="stroke-width: 2.5"]')).to_have_count(2)
    positions = figure.locator('.react-flow__node').evaluate_all('(ns)=>ns.map(n=>[n.dataset.id,n.style.transform])')
    assert positions == geometry['positions'], '分步只聚焦，不重新排布节点'
    figure.locator('.react-flow__node-lesson').get_by_role('button', name='基准归位', exact=True).click()
    expect(figure.get_by_text('基准两侧形成子数组。', exact=True)).to_be_visible()
    directions.get_by_role('button', name='横向', exact=True).click()
    expect(canvas).to_have_attribute('data-direction', 'LR')
    page.wait_for_function('''() => {
      const canvas=document.querySelector('.diagram-canvas'), box=canvas.getBoundingClientRect();
      return [...canvas.querySelectorAll('.react-flow__node-lesson')].every(node=>{
        const rect=node.getBoundingClientRect();
        return rect.left>=box.left && rect.right<=box.right && rect.top>=box.top && rect.bottom<=box.bottom;
      });
    }''')
    figure.screenshot(path='data/diagram-branch-horizontal-desktop.png')
    directions.get_by_role('button', name='纵向', exact=True).click()
    expect(canvas).to_have_attribute('data-direction', 'TB')
    directions.get_by_role('button', name='自动', exact=True).click()
    expect(canvas).to_have_attribute('data-direction', 'TB')
    page.set_viewport_size({'width': 1180, 'height': 1400})
    expect(canvas).to_have_attribute('data-direction', 'TB')
    figure.screenshot(path='data/diagram-branch-1180-desktop.png')
    assert not errors, errors
    browser.close()
print('PASS: desktop branching/merging, readable auto direction, labels, stable steps, node details and manual direction controls')
