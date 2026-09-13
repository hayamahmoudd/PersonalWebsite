/* Shared mobile drawers; moving the existing menus preserves their link handlers. */
(() => {
  const mobile = window.matchMedia('(max-width: 1040px)');
  const menu = document.getElementById('nav-menu');
  const toggle = document.querySelector('.menu-toggle');
  if (!menu || !toggle) return;
  const drawers = [];

  function makeDrawer(content, trigger, title) {
    const placeholder = document.createComment(`${title} desktop position`);
    content.before(placeholder);
    const dialog = document.createElement('dialog');
    dialog.className = 'mobile-drawer';
    dialog.id = `drawer-${drawers.length}`;
    dialog.setAttribute('aria-label', title);
    const heading = document.createElement('div');
    heading.className = 'drawer-heading';
    const label = document.createElement('strong');
    label.textContent = title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'drawer-close';
    close.textContent = '×';
    close.setAttribute('aria-label', `Close ${title.toLowerCase()}`);
    heading.append(label, close);
    dialog.append(heading);
    document.body.append(dialog);
    trigger.setAttribute('aria-controls', dialog.id);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-haspopup', 'dialog');
    const dismiss = () => { if (dialog.open) dialog.close(); };
    close.addEventListener('click', dismiss);
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      }
    });
    dialog.addEventListener('click', event => {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
      if (event.target.closest('a')) dismiss();
    });
    dialog.addEventListener('close', () => {
      trigger.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('drawer-open');
      menu.classList.remove('active');
      if (mobile.matches) trigger.focus({ preventScroll: true });
    });
    const open = () => {
      dialog.showModal();
      trigger.setAttribute('aria-expanded', 'true');
      document.body.classList.add('drawer-open');
    };
    const sync = () => {
      dismiss();
      if (mobile.matches) dialog.append(content);
      else placeholder.after(content);
      menu.classList.remove('active');
    };
    drawers.push({ sync });
    return open;
  }

  toggle.removeAttribute('onclick');
  toggle.setAttribute('aria-label', 'Open navigation');
  toggle.addEventListener('click', makeDrawer(menu, toggle, 'Navigation'));
  const toc = document.querySelector('.report-toc');
  if (toc) {
    const sections = document.createElement('button');
    sections.type = 'button';
    sections.className = 'report-menu-toggle';
    sections.textContent = 'Report sections';
    toggle.before(sections);
    sections.addEventListener('click', makeDrawer(toc, sections, 'Report sections'));
  }
  mobile.addEventListener('change', () => drawers.forEach(drawer => drawer.sync()));
  drawers.forEach(drawer => drawer.sync());
})();
