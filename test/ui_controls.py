from playwright.sync_api import expect

def space_picker(page):
    return page.get_by_role('combobox', name='切换空间', exact=True)

def select_space(page, value):
    trigger = space_picker(page)
    trigger.click()
    page.get_by_role('listbox', name='切换空间', exact=True).locator(f'[role="option"][data-value="{value}"]').click()
    expect(trigger).to_have_attribute('data-value', str(value))

def expect_space_absent(page, value):
    trigger = space_picker(page)
    trigger.press('ArrowDown')
    menu = page.get_by_role('listbox', name='切换空间', exact=True)
    expect(menu).to_be_visible()
    expect(menu.locator(f'[role="option"][data-value="{value}"]')).to_have_count(0)
    trigger.press('Escape')
