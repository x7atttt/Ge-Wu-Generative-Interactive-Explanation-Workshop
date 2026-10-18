import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from ui_controls import select_space, space_picker, expect_space_absent

BASE = 'http://127.0.0.1:3100'
f = json.loads(Path('data/iteration28-fixture.json').read_text(encoding='utf-8'))
HUB_TITLE = '空间管理：查看所有空间与资料归属、新建/重命名/删除/移动'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 763, 'height': 871})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    page.evaluate('(ids) => localStorage.setItem("gewu-attached", JSON.stringify(ids))', [f['current']['sourceId'], f['other']['sourceId']])
    page.reload()
    page.wait_for_load_state('networkidle')
    picker = space_picker(page)
    confirm = page.get_by_role('alertdialog')
    def row(item):
        return page.get_by_text('空间管理', exact=True).locator('..').locator('div.rounded-lg.border.border-stone-100').filter(has_text=item['name']).first
    def select(item):
        select_space(page, item['id'])
        expect(page.get_by_role('heading', name='今天从这里开始')).to_be_visible()
    def open_lecture(item):
        page.get_by_role('button', name=f'{item["name"]} 待巩固', exact=False).click()
        expect(page.get_by_role('heading', name=item['childTitle'], exact=True)).to_be_visible()
    def assert_gone(item):
        expect_space_absent(page, item['id'])
        assert page.request.get(f'{BASE}/api/spaces/{item["id"]}').status == 404
        assert page.request.get(f'{BASE}/api/docs/{item["rootId"]}').status == 404
        assert page.request.get(f'{BASE}/api/sources/{item["sourceId"]}').status == 404
    def approve():
        expect(confirm.get_by_role('radio')).to_have_count(0)
        confirm.get_by_role('button', name='彻底删除空间', exact=True).click()

    # A manager deletion must succeed locally even while a list request is pending.
    select(f['current'])
    open_lecture(f['current'])
    page.get_by_title(HUB_TITLE).click()
    held = []
    def stale_spaces(route):
        if not held:
            held.append((route, route.fetch()))
        else:
            route.fulfill(status=503, json={'error': '删除后列表刷新失败'})
    page.route('**/api/spaces', stale_spaces)
    row(f['current']).get_by_role('button', name='改名', exact=True).click()
    with page.expect_request(lambda request: request.url == BASE + '/api/spaces' and request.method == 'GET'):
        page.get_by_text('空间管理', exact=True).locator('..').get_by_role('button', name='保存', exact=True).click()
    for _ in range(100):
        if held:
            break
        page.wait_for_timeout(20)
    assert held, 'No stale list request was captured'
    deletion = []
    page.route(f'**/api/spaces/{f["current"]["id"]}', lambda route: deletion.append((route, route.fetch())) if route.request.method == 'DELETE' else route.continue_())
    row(f['current']).get_by_role('button', name='删除', exact=True).click()
    approve()
    expect(row(f['current']).get_by_role('button', name='删除中…', exact=True)).to_be_disabled()
    expect(picker).to_be_disabled()
    expect(row(f['other']).get_by_role('button', name=f['other']['name'], exact=True)).to_be_disabled()
    for _ in range(100):
        if deletion:
            break
        page.wait_for_timeout(20)
    assert len(deletion) == 1
    deletion[0][0].fulfill(response=deletion[0][1])
    expect(picker).to_have_attribute('data-value', '')
    expect(row(f['current'])).to_have_count(0)
    expect(page.get_by_role('heading', name='今天从这里开始')).to_have_count(0)
    expect(page.get_by_role('heading', name=f['current']['childTitle'], exact=True)).to_have_count(0)
    assert page.evaluate('localStorage.getItem("gewu-space")') == ''
    assert json.loads(page.evaluate('localStorage.getItem("gewu-attached")')) == [f['other']['sourceId']]
    held[0][0].fulfill(response=held[0][1])
    page.wait_for_load_state('networkidle')
    assert_gone(f['current'])
    expect(row(f['current'])).to_have_count(0)
    page.unroute('**/api/spaces', stale_spaces)
    page.keyboard.press('Escape')
    page.get_by_role('button', name='历史讲解', exact=False).click()
    expect(page.get_by_text(f['current']['childTitle'], exact=True)).to_have_count(0)
    expect(page.get_by_text(f['other']['docTitle'], exact=True)).to_be_visible()
    page.keyboard.press('Escape')
    page.get_by_title('批量导入文档资料，生成讲解时作为事实依据').click()
    expect(page.get_by_title(f['current']['sourceTitle'], exact=True)).to_have_count(0)
    expect(page.get_by_title(f['other']['sourceTitle'], exact=True)).to_be_visible()
    assert sorted(card['id'] for card in page.request.get(f'{BASE}/api/cards?spaceId={f["other"]["id"]}&all=1').json()['cards']) == sorted(f['other']['cardIds'])
    assert page.request.get(f'{BASE}/api/exams/{f["other"]["sessionId"]}').status == 200
    page.get_by_role('button', name='关闭资料', exact=True).click()

    # A list failure cannot leave the current row/map behind; deleting another row preserves current content.
    select(f['toolbar'])
    open_lecture(f['toolbar'])
    page.route('**/api/spaces', lambda route: route.fulfill(status=503, json={'error': '列表暂不可用'}))
    page.get_by_title(HUB_TITLE).click()
    row(f['other']).get_by_role('button', name='删除', exact=True).click()
    approve()
    expect(picker).to_have_attribute('data-value', str(f['toolbar']['id']))
    expect(row(f['other'])).to_have_count(0)
    expect(page.get_by_role('heading', name=f['toolbar']['childTitle'], exact=True)).to_be_visible()
    assert page.request.get(f'{BASE}/api/docs/{f["toolbar"]["rootId"]}').status == 200
    assert_gone(f['other'])
    page.keyboard.press('Escape')
    page.unroute('**/api/spaces')
    page.get_by_title('彻底删除当前空间及其内容').click()
    approve()
    expect(picker).to_have_attribute('data-value', '')
    assert_gone(f['toolbar'])

    # A previously persisted selection can point at an externally deleted space while list data is stale.
    stale = page.request.get(BASE + '/api/spaces').json()
    page.request.delete(f'{BASE}/api/spaces/{f["missing"]["id"]}')
    page.evaluate('(id) => localStorage.setItem("gewu-space", String(id))', f['missing']['id'])
    page.route('**/api/spaces', lambda route: route.fulfill(json=stale))
    with page.expect_response(lambda response: response.url.endswith(f'/api/spaces/{f["missing"]["id"]}/map') and response.status == 404):
        page.reload()
    expect(picker).to_have_attribute('data-value', '')
    expect_space_absent(page, f['missing']['id'])
    assert page.evaluate('localStorage.getItem("gewu-space")') == ''
    expect(page.get_by_text('空间不存在，已保留上次内容。', exact=False)).to_have_count(0)
    page.unroute('**/api/spaces')

    # Late history-list and lecture responses cannot restore deleted content.
    pending = []
    def hold(route):
        pending.append((route, route.fetch()))
    page.route(f'**/api/docs?spaceId={f["late"]["id"]}', hold)
    page.route(f'**/api/docs/{f["late"]["childId"]}', hold)
    select(f['late'])
    page.get_by_role('button', name=f'{f["late"]["name"]} 待巩固', exact=False).click()
    for _ in range(100):
        if len(pending) == 2:
            break
        page.wait_for_timeout(20)
    assert len(pending) == 2, len(pending)
    page.get_by_title('彻底删除当前空间及其内容').click()
    approve()
    expect(picker).to_have_attribute('data-value', '')
    for route, response in pending:
        route.fulfill(response=response)
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('heading', name=f['late']['childTitle'], exact=True)).to_have_count(0)
    page.get_by_role('button', name='历史讲解', exact=False).click()
    expect(page.get_by_text(f['late']['childTitle'], exact=True)).to_have_count(0)
    assert_gone(f['late'])
    expect(page.get_by_text('空间不存在，已保留上次内容。', exact=False)).to_have_count(0)
    page.keyboard.press('Escape')
    page.screenshot(path='data/iteration28-after-delete.png', full_page=True)
    assert not errors, errors
    print('PASS: manager current/noncurrent deletion, toolbar deep deletion, attached/history/cache cleanup, missing-space 404, stale list and lecture responses')
    browser.close()
