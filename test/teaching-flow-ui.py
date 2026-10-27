import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from ui_controls import select_space

BASE = 'http://127.0.0.1:3100'
fixture = json.loads(Path('data/teaching-flow-fixture.json').read_text(encoding='utf-8'))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    errors, attempts = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: attempts.append(request.post_data_json) if request.url.endswith('/api/attempts') else None)
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    select_space(page, fixture['spaceId'])
    page.get_by_role('button', name=re.compile('历史讲解')).click()
    page.get_by_role('button', name=re.compile(rf'正弦波的频率\s+#{fixture["docId"]}\b')).click()
    prediction = page.get_by_role('heading', name='先预测', exact=True)
    observe = page.get_by_role('heading', name='动手观察', exact=True)
    explain = page.get_by_role('heading', name='解释现象', exact=True)
    transfer = page.get_by_role('heading', name='变式自测', exact=True)
    for heading in [prediction, observe, explain, transfer]:
        expect(heading).to_be_visible()
    assert prediction.bounding_box()['y'] < observe.bounding_box()['y'] < explain.bounding_box()['y'] < transfer.bounding_box()['y']
    assert not attempts, '阅读预测不应产生练习记录'
    figure = page.locator('figure').filter(has_text='固定振幅，观察频率变化')
    expect(figure.get_by_text('固定振幅，观察频率变化（横轴：时间（秒））', exact=True)).to_be_visible()
    before = figure.locator('.MafsView').screenshot()
    frequency = page.get_by_role('spinbutton', name='频率 f 数值', exact=True)
    frequency.fill('2')
    frequency.press('Enter')
    expect(page.get_by_role('slider', name='频率 f', exact=True)).to_have_value('2')
    after = figure.locator('.MafsView').screenshot()
    assert before != after, '图形必须响应实际控件变化'
    assert not attempts, '观察操作不应产生练习记录'
    prediction.scroll_into_view_if_needed()
    page.screenshot(path='data/teaching-flow-desktop.png', full_page=True)
    with page.expect_response(lambda response: response.url.endswith('/api/attempts') and response.request.method == 'POST') as saved:
        page.get_by_role('button', name='2 Hz，0.5 秒', exact=True).click()
    assert saved.value.ok
    expect(page.get_by_text('回答正确！', exact=True)).to_be_visible()
    assert len(attempts) == 1 and attempts[0]['correct'] is True
    response = page.request.post(BASE + '/api/cards/from-doc', data={'docId': fixture['docId']})
    assert response.ok and response.json()['added'] == 1
    cards = page.request.get(f'{BASE}/api/cards?spaceId={fixture["spaceId"]}&all=1').json()['cards']
    assert len(cards) == 1 and '3 秒内完成 6 次' in cards[0]['front']
    for preview in fixture.get('previews', []):
        page.get_by_role('button', name=re.compile('历史讲解')).click()
        page.get_by_role('button', name=re.compile(rf'{re.escape(preview["title"])}\s+#{preview["id"]}\b')).click()
        expect(page.get_by_role('heading', name=preview['title'], exact=True).first).to_be_visible()
        for diagram in preview['diagrams']:
            graph = page.get_by_role('figure', name=diagram['title'], exact=True)
            expect(graph.locator('.react-flow__node-lesson')).to_have_count(diagram['nodes'], timeout=20000)
            expect(graph.get_by_text('正在排布架构图…', exact=True)).to_have_count(0)
            graph.screenshot(path=f'data/teaching-eval/{fixture["evalRun"]}/desktop-{preview["caseId"]}-diagram.png')
        expect(page.locator('.katex-error')).to_have_count(0)
        page.screenshot(path=f'data/teaching-eval/{fixture["evalRun"]}/desktop-{preview["caseId"]}.png', full_page=True)
    assert not errors, errors
    browser.close()
