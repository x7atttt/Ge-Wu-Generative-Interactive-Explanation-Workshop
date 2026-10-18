"""开发模式回归：初始化及多次删除后，统计与历史的 key 唯一且仍能独立重置。"""
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = set()
    page.on('console', lambda message: errors.add(message.text) if 'Encountered two children with the same key' in message.text else None)
    page.on('pageerror', lambda error: errors.add(str(error)))

    # 所有业务 API 均由夹具响应，不向真实数据库写入或发起模型请求。
    spaces = [{'id': 900001 + i, 'name': f'顶部入口回归-{i}', 'sourceCount': 0, 'docCount': 0,
               'note': '', 'examDate': None, 'roadmap': None, 'roadmapAt': None,
               'roadmapStale': False, 'createdAt': '2026-10-18T00:00:00Z'} for i in range(2)]
    deleted = []
    stats_requests = []

    def api(route):
        path = route.request.url.split('/api/', 1)[1]
        if path == 'spaces' and route.request.method == 'GET':
            route.fulfill(json={'spaces': spaces})
        elif path.startswith('spaces/') and route.request.method == 'DELETE':
            space_id = int(path.split('/')[1])
            assert any(space['id'] == space_id for space in spaces)
            spaces[:] = [space for space in spaces if space['id'] != space_id]
            deleted.append(space_id)
            route.fulfill(json={'docIds': [], 'sourceIds': []})
        elif path == 'sources':
            route.fulfill(json={'sources': []})
        elif path == 'docs':
            route.fulfill(json={'docs': []})
        elif path == 'stats':
            stats_requests.append(path)
            route.fulfill(json={'attemptCount': 0, 'docCount': 0, 'daily': [], 'concepts': [], 'byType': []})
        else:
            raise AssertionError(f'Unexpected test request: {route.request.method} {path}')

    page.route('**/api/**', api)
    page.goto('http://127.0.0.1:3100/')
    page.wait_for_load_state('networkidle')
    assert not errors, errors
    stats = page.get_by_role('button', name='学习统计', exact=True)
    history = page.get_by_role('button', name='历史讲解', exact=True)
    search = page.get_by_placeholder('搜索标题或编号…', exact=True)
    hub = page.get_by_title('空间管理：查看所有空间与资料归属、新建/重命名/删除/移动')

    for revision in range(2):
        expect(stats).to_have_count(1)
        expect(history).to_have_count(1)
        stats.click()
        expect(page.get_by_text('还没有练习记录', exact=False)).to_be_visible()
        history.click()
        expect(search).to_have_value('')
        search.fill('保留到删除前')
        # 历史面板有点击遮罩，使用键盘打开管理入口以保留待验证的面板状态。
        hub.press('Enter')
        row = page.get_by_role('heading', name='空间管理', exact=True).locator('..').locator('div.rounded-lg.border.border-stone-100').filter(has_text=f'顶部入口回归-{revision}')
        row.get_by_role('button', name='删除', exact=True).click()
        page.get_by_role('alertdialog').get_by_role('button', name='彻底删除空间', exact=True).click()
        expect(row).to_have_count(0)
        # revision 更新仍须卸载旧面板，避免旧查询/统计缓存残留。
        expect(search).to_have_count(0)
        expect(page.get_by_role('button', name='收起', exact=True)).to_have_count(0)
        page.keyboard.press('Escape')
        assert not errors, errors

    history.click()
    expect(search).to_have_value('')
    page.keyboard.press('Escape')
    stats.click()
    expect(page.get_by_text('还没有练习记录', exact=False)).to_be_visible()
    assert len(stats_requests) == 3, stats_requests
    assert deleted == [900001, 900002], deleted
    assert not errors, errors
    print('PASS: development console has no duplicate keys on mount or repeated deletion; stats/history remain unique and reset independently')
    browser.close()
