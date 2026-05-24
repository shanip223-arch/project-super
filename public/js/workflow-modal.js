(function () {
  const THEME_META = {
    warning: { icon: '⚠️', label: 'Objection Raised', tone: 'warning' },
    review: { icon: '🛡️', label: 'Objection Resubmitted', tone: 'review' },
    success: { icon: '✅', label: 'Objection Cleared', tone: 'success' },
    notice: { icon: '📢', label: 'Workflow Notice', tone: 'notice' }
  };

  class WorkflowModalEngine {
    constructor(options = {}) {
      this.options = options;
      this.active = null;
      this.boundKeyHandler = this.handleKeydown.bind(this);
      this.ensureHost();
    }

    ensureHost() {
      this.host = document.getElementById('workflowModalHost');
      if (!this.host) {
        this.host = document.createElement('div');
        this.host.id = 'workflowModalHost';
        document.body.appendChild(this.host);
      }
    }

    open(config = {}) {
      const theme = THEME_META[config.theme] || THEME_META.warning;
      const critical = config.critical !== false;
      this.active = { ...config, critical, theme: config.theme || 'warning' };
      document.body.classList.add('workflow-modal-open');
      if (critical) document.body.classList.add('workflow-critical-lock');

      this.host.innerHTML = `
        <section class="workflow-overlay workflow-overlay--${theme.tone}" role="dialog" aria-modal="true" aria-labelledby="workflowModalTitle" data-critical="${critical}">
          <div class="workflow-modal-card" onclick="event.stopPropagation()">
            <div class="workflow-modal-glow"></div>
            <header class="workflow-modal-header">
              <div class="workflow-modal-icon" aria-hidden="true">${config.icon || theme.icon}</div>
              <div>
                <p class="workflow-eyebrow">${config.eyebrow || 'BAR COUNCIL WORKFLOW LOCK'}</p>
                <h2 id="workflowModalTitle">${config.title || theme.label}</h2>
                <p class="workflow-subtitle">${config.subtitle || 'Please complete the required workflow action to continue.'}</p>
              </div>
              ${critical ? '<span class="workflow-lock-pill">🔒 Critical</span>' : '<button class="workflow-close" type="button" aria-label="Close" data-workflow-close>×</button>'}
            </header>
            <div class="workflow-modal-body">${config.body || ''}</div>
            ${config.footer ? `<footer class="workflow-modal-footer">${config.footer}</footer>` : ''}
          </div>
        </section>`;

      const closeBtn = this.host.querySelector('[data-workflow-close]');
      if (closeBtn) closeBtn.addEventListener('click', () => this.close());
      document.addEventListener('keydown', this.boundKeyHandler);
      this.applyLocks(config.lockSelector || '.main-content, .sidebar');
      if (typeof config.onOpen === 'function') config.onOpen(this.host);
    }

    close() {
      this.host.innerHTML = '';
      document.body.classList.remove('workflow-modal-open', 'workflow-critical-lock');
      document.removeEventListener('keydown', this.boundKeyHandler);
      this.releaseLocks();
      this.active = null;
    }

    handleKeydown(e) {
      if (!this.active) return;
      if (e.key === 'Escape' && this.active.critical) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    applyLocks(selector) {
      document.querySelectorAll(selector).forEach(el => {
        if (el.id === 'workflowModalHost' || el.closest('#workflowModalHost')) return;
        el.setAttribute('aria-hidden', 'true');
        el.classList.add('workflow-background-locked');
      });
    }

    releaseLocks() {
      document.querySelectorAll('.workflow-background-locked').forEach(el => {
        el.removeAttribute('aria-hidden');
        el.classList.remove('workflow-background-locked');
      });
    }
  }

  window.WorkflowModalEngine = WorkflowModalEngine;
})();
