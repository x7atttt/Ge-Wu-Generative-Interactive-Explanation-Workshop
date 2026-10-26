import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from ui_controls import select_space

BASE = 'http://127.0.0.1:3100'
MODEL = 'http://127.0.0.1:3101'
f = json.loads(Path('data/diagram-effort-fixture.json').read_text(encoding='utf-8'))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 1000}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    effort = page.get_by_role('combobox', name='思考强度', exact=True)

    def choose_effort(value):
        effort.scroll_into_view_if_needed()
        effort.click()
        page.get_by_role('listbox', name='思考强度', exact=True).locator(f'[data-value="{value}"]').click()
        expect(effort).to_have_attribute('data-value', value)

    expect(effort).to_have_attribute('data-value', 'high')
    choose_effort('low')
    page.reload()
    expect(effort).to_have_attribute('data-value', 'low')
    select_space(page, f['spaceId'])
    choose_effort('max')
    page.request.post(MODEL + '/control', data=json.dumps({'outputs': [f['doc']], 'delay': 700, 'streamPause': 2500}))
    page.get_by_placeholder('想搞懂什么概念？如：正弦波的频率、英语名词复数、快速排序', exact=True).fill('Transformer 架构')
    web = page.get_by_role('button', name='联网检索', exact=True)
    if web.get_attribute('aria-pressed') == 'true':
        web.click()
    page.get_by_role('button', name='生成讲解', exact=True).click()
    expect(effort).to_be_disabled()
    figure = page.get_by_role('figure', name=f['doc']['blocks'][2]['title'], exact=True)
    expect(figure).to_be_visible(timeout=20000)
    expect(figure.locator('.react-flow__node-lesson')).to_have_count(8, timeout=20000)
    expect(page.get_by_role('region', name='讲解生成进度', exact=True)).to_be_visible()
    expect(figure.get_by_text('正在排布架构图…', exact=True)).to_have_count(0)
    expect(figure.get_by_text('编码器 · Encoder', exact=True)).to_be_visible()
    expect(figure.get_by_text('解码器 · Decoder', exact=True)).to_be_visible()
    assert page.request.get(MODEL + '/state').json()['requests'][-1]['effort'] == 'max'
    expect(effort).to_be_enabled()
    expect(figure.locator('path.react-flow__edge-path')).to_have_count(8)
    expect(figure.locator('path.react-flow__edge-path[style*="stroke-dasharray"]')).to_have_count(1)

    # Real rendered edge endpoints must meet their source/target boxes, including group-local paths.
    graph_geometry = figure.evaluate('''el => {
      const boxes = Object.fromEntries([...el.querySelectorAll('.react-flow__node-lesson')].map(n => [n.dataset.id, n.getBoundingClientRect().toJSON()]));
      return [...el.querySelectorAll('.react-flow__edge')].map(e => {
        const p=e.querySelector('path.react-flow__edge-path'), matrix=p.getScreenCTM();
        const start=p.getPointAtLength(0).matrixTransform(matrix), end=p.getPointAtLength(p.getTotalLength()).matrixTransform(matrix);
        return {id:e.dataset.id, start:{x:start.x,y:start.y}, end:{x:end.x,y:end.y}, boxes};
      });
    }''')
    for edge in graph_geometry:
        spec = next(e for e in f['doc']['blocks'][2]['edges'] if e['id'] == edge['id'])
        for endpoint, key in [('start', 'source'), ('end', 'target')]:
            box = edge['boxes']['node:' + spec[key]]
            point = edge[endpoint]
            assert box['x'] - 3 <= point['x'] <= box['x'] + box['width'] + 3, edge['id']
            assert box['y'] - 3 <= point['y'] <= box['y'] + box['height'] + 3, edge['id']

    figure.scroll_into_view_if_needed()
    figure.screenshot(path='data/diagram-overview-desktop.png')
    figure.locator('.react-flow__node-lesson').get_by_role('button', name='编码器自注意力', exact=True).click()
    expect(figure.get_by_text('输入序列内部交换信息，形成上下文表示。', exact=True)).to_be_visible()
    steps = figure.get_by_role('group', name='架构图讲解步骤', exact=True)
    steps.get_by_role('button', name='2. 读取上下文', exact=True).click()
    expect(figure.get_by_text('解码器同时利用已有输出和编码器表示，连接两侧的信息。', exact=True)).to_be_visible()
    assert figure.locator('path.react-flow__edge-path[style*="stroke-width: 2.5"]').count() == 2
    figure.screenshot(path='data/diagram-step-desktop.png')
    transform = figure.locator('.react-flow__viewport').get_attribute('style')
    figure.get_by_role('button', name='放大架构图', exact=True).click()
    expect(figure.locator('.react-flow__viewport')).not_to_have_attribute('style', transform)
    figure.get_by_role('button', name='适应视图', exact=True).click()
    figure.locator('summary').click()
    navigation = figure.locator('details').get_by_role('button', name='编码器—解码器交叉注意力', exact=True)
    navigation.focus()
    navigation.press('Enter')
    expect(figure.get_by_text('以解码器表示为查询，读取编码器提供的键和值。', exact=True)).to_be_visible()
    figure.locator('summary').click()
    for width in [714, 390]:
        page.set_viewport_size({'width': width, 'height': 900})
        steps.get_by_role('button', name='总览', exact=True).click()
        figure.get_by_role('button', name='适应视图', exact=True).click()
        figure.scroll_into_view_if_needed()
        page.wait_for_timeout(200)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'页面溢出 {width}'
        assert figure.evaluate('(el)=>el.scrollWidth <= el.clientWidth'), f'图块溢出 {width}'
        figure.screenshot(path=f'data/diagram-overview-{width}.png')
        steps.get_by_role('button', name='1. 理解输入', exact=True).click()
        figure.screenshot(path=f'data/diagram-step-{width}.png')
    page.set_viewport_size({'width': 1280, 'height': 1000})

    # Refine and ask use the newly selected effort, rather than retaining the generation setting.
    choose_effort('low')
    page.request.post(MODEL + '/control', data=json.dumps({'outputs': [f['refined']]}))
    page.get_by_placeholder('或直接输入你想要的深化方向', exact=True).fill('改为纵向数据流')
    page.get_by_role('button', name='深化', exact=True).click()
    refined = page.get_by_role('figure', name=f['refined']['blocks'][2]['title'], exact=True)
    expect(refined.locator('.react-flow__node-lesson')).to_have_count(8, timeout=20000)
    assert page.request.get(MODEL + '/state').json()['requests'][-1]['effort'] == 'low'
    refined.screenshot(path='data/diagram-horizontal-desktop.png')
    choose_effort('high')
    page.request.post(MODEL + '/control', data=json.dumps({'outputs': ['交叉注意力读取编码器的输出表示。']}))
    page.get_by_role('button', name='追问细节', exact=True).click()
    page.get_by_placeholder('如：这题为什么选 B？（📷 / 粘贴 / 拖入截图提问）', exact=True).fill('交叉注意力读取什么？')
    page.get_by_role('button', name='追问', exact=True).click()
    expect(page.get_by_text('交叉注意力读取编码器的输出表示。', exact=True)).to_be_visible(timeout=10000)
    assert page.request.get(MODEL + '/state').json()['requests'][-1]['effort'] == 'high'
    # A diagram first mounted on a phone opens on the first step, with readable module labels.
    mobile = browser.new_page(viewport={'width': 390, 'height': 900}, reduced_motion='reduce')
    mobile.goto(BASE)
    mobile.wait_for_load_state('networkidle')
    select_space(mobile, f['spaceId'])
    mobile.get_by_role('button', name='历史讲解', exact=False).click()
    mobile.get_by_text(f['refined']['title'], exact=True).first.click()
    mobile_figure = mobile.get_by_role('figure', name=f['refined']['blocks'][2]['title'], exact=True)
    expect(mobile_figure.locator('.react-flow__node-lesson')).to_have_count(8, timeout=10000)
    expect(mobile_figure.get_by_role('button', name='1. 理解输入', exact=True)).to_have_attribute('aria-pressed', 'true')
    mobile_figure.screenshot(path='data/diagram-mobile-first-step.png')
    assert mobile.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    mobile.close()
    assert not errors, errors
    browser.close()
print('PASS: diagram grouped edges, step highlights, node details, zoom/navigation, mobile layout, effort persistence and request forwarding; no console errors')
