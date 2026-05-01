/**
 * GTM Demo Video - "Breakthroughs Become Team Infrastructure"
 *
 * Run with the local product already running:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3001 npx playwright test --config=playwright-video.config.ts e2e/video-gtm-demo.spec.ts
 *
 * Output:
 *   test-results/videos/
 */
import { test, expect, type Page } from '@playwright/test';
import { apiGet, loginAs } from './fixtures/test-helpers';

const APP_BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
const TOTAL_SCENES = 9;

type Caption = {
  eyebrow: string;
  headline: string;
  body?: string;
  scene: number;
};

async function pace(page: Page, ms = 1800) {
  await page.waitForTimeout(ms);
}

async function installDemoOverlay(page: Page) {
  await page.addStyleTag({
    content: `
      @keyframes hearthDemoRise {
        from { opacity: 0; transform: translateY(14px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      @keyframes hearthDemoPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(226, 94, 45, 0.28); }
        50% { box-shadow: 0 0 0 10px rgba(226, 94, 45, 0); }
      }

      #hearth-demo-caption {
        position: fixed;
        left: 96px;
        bottom: 28px;
        z-index: 2147483000;
        max-width: 540px;
        padding: 18px 20px 19px;
        border: 1px solid rgba(255, 255, 255, 0.13);
        border-radius: 18px;
        background: rgba(16, 16, 20, 0.88);
        color: #fff;
        box-shadow: 0 26px 80px rgba(0, 0, 0, 0.34);
        backdrop-filter: blur(16px);
        pointer-events: none;
        animation: hearthDemoRise 360ms cubic-bezier(.2,.8,.2,1) both;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #hearth-demo-caption .demo-eyebrow {
        color: #ff865a;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.16em;
        line-height: 1;
        margin-bottom: 9px;
        text-transform: uppercase;
      }

      #hearth-demo-caption .demo-headline {
        font-size: 30px;
        font-weight: 760;
        letter-spacing: -0.02em;
        line-height: 1.02;
      }

      #hearth-demo-caption .demo-body {
        color: rgba(255, 255, 255, 0.76);
        font-size: 14px;
        line-height: 1.5;
        margin-top: 10px;
      }

      #hearth-demo-progress {
        position: fixed;
        top: 18px;
        right: 24px;
        z-index: 2147483000;
        display: flex;
        gap: 5px;
        padding: 8px 10px;
        border-radius: 999px;
        background: rgba(16, 16, 20, 0.58);
        backdrop-filter: blur(14px);
        pointer-events: none;
      }

      #hearth-demo-progress span {
        width: 22px;
        height: 4px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.26);
      }

      #hearth-demo-progress span.active {
        background: #ff6b35;
      }

      #hearth-demo-badge {
        position: fixed;
        left: 96px;
        top: 22px;
        z-index: 2147483000;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 9px 12px 9px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.88);
        border: 1px solid rgba(0, 0, 0, 0.08);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.12);
        color: #16161a;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        font-weight: 750;
        pointer-events: none;
      }

      #hearth-demo-badge .mark {
        display: grid;
        width: 24px;
        height: 24px;
        place-items: center;
        border-radius: 8px;
        background: linear-gradient(135deg, #f97345, #a855f7);
        color: #fff;
        font-family: Georgia, serif;
        font-size: 16px;
        font-weight: 800;
      }

      #hearth-demo-endcard {
        position: fixed;
        inset: 0;
        z-index: 2147483100;
        display: grid;
        place-items: center;
        padding: 48px;
        background:
          radial-gradient(circle at 16% 24%, rgba(255, 107, 53, 0.22), transparent 28%),
          radial-gradient(circle at 82% 12%, rgba(168, 85, 247, 0.16), transparent 26%),
          #101014;
        color: #fff;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #hearth-demo-endcard .end-inner {
        max-width: 920px;
        text-align: center;
        animation: hearthDemoRise 500ms cubic-bezier(.2,.8,.2,1) both;
      }

      #hearth-demo-endcard .end-brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 28px;
        color: rgba(255, 255, 255, 0.74);
        font-size: 15px;
        font-weight: 750;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      #hearth-demo-endcard .end-mark {
        display: grid;
        width: 40px;
        height: 40px;
        place-items: center;
        border-radius: 13px;
        background: linear-gradient(135deg, #f97345, #a855f7);
        color: #fff;
        font-family: Georgia, serif;
        font-size: 26px;
        font-weight: 800;
      }

      #hearth-demo-endcard h1 {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 68px;
        font-weight: 760;
        letter-spacing: -0.045em;
        line-height: 0.96;
      }

      #hearth-demo-endcard p {
        max-width: 760px;
        margin: 24px auto 0;
        color: rgba(255, 255, 255, 0.74);
        font-size: 22px;
        line-height: 1.45;
      }

      #hearth-demo-endcard .end-cta {
        display: inline-flex;
        margin-top: 34px;
        padding: 13px 18px;
        border-radius: 999px;
        background: #fff;
        color: #101014;
        font-size: 15px;
        font-weight: 800;
      }

      .hearth-demo-spotlight {
        animation: hearthDemoPulse 1300ms ease-in-out 2;
        outline: 2px solid #ff6b35 !important;
        outline-offset: 4px !important;
        border-radius: 12px !important;
      }
    `,
  });

  await page.evaluate((totalScenes) => {
    if (!document.getElementById('hearth-demo-badge')) {
      const badge = document.createElement('div');
      badge.id = 'hearth-demo-badge';
      badge.innerHTML = '<span class="mark">H</span><span>Hearth product demo</span>';
      document.body.appendChild(badge);
    }

    if (!document.getElementById('hearth-demo-progress')) {
      const progress = document.createElement('div');
      progress.id = 'hearth-demo-progress';
      progress.innerHTML = Array.from({ length: totalScenes }, () => '<span></span>').join('');
      document.body.appendChild(progress);
    }

    if (!document.getElementById('hearth-demo-caption')) {
      const caption = document.createElement('div');
      caption.id = 'hearth-demo-caption';
      caption.innerHTML = '<div class="demo-eyebrow"></div><div class="demo-headline"></div><div class="demo-body"></div>';
      document.body.appendChild(caption);
    }
  }, TOTAL_SCENES);
}

async function showCaption(page: Page, caption: Caption, ms = 2800) {
  await installDemoOverlay(page);
  await page.evaluate(({ eyebrow, headline, body, scene, total }) => {
    const root = document.getElementById('hearth-demo-caption');
    if (!root) return;
    root.querySelector('.demo-eyebrow')!.textContent = eyebrow;
    root.querySelector('.demo-headline')!.textContent = headline;
    root.querySelector('.demo-body')!.textContent = body ?? '';
    root.setAttribute('style', 'animation: none');
    void root.offsetHeight;
    root.setAttribute('style', '');

    const dots = Array.from(document.querySelectorAll('#hearth-demo-progress span'));
    dots.forEach((dot, index) => {
      dot.classList.toggle('active', index < Math.min(scene, total));
    });
  }, { ...caption, total: TOTAL_SCENES });
  await pace(page, ms);
}

async function gotoApp(page: Page, hashPath: string) {
  await page.goto(`${APP_BASE}/#${hashPath}`);
  await page.waitForLoadState('domcontentloaded');
  await pace(page, 1000);
  await installDemoOverlay(page);
}

async function spotlight(page: Page, text: string) {
  const target = page.getByText(text, { exact: false }).first();
  if (!(await target.isVisible().catch(() => false))) return;

  await target.scrollIntoViewIfNeeded();
  await target.evaluate((node) => {
    node.classList.add('hearth-demo-spotlight');
    window.setTimeout(() => node.classList.remove('hearth-demo-spotlight'), 2800);
  });
  await pace(page, 1200);
}

async function findDemoSessionId(page: Page) {
  const own = await apiGet(page, '/chat/sessions');
  const shared = await apiGet(page, '/chat/sessions/shared').catch(() => ({ body: { data: [] } }));
  const sessions = [...(own.body.data ?? []), ...(shared.body.data ?? [])] as Array<{ id: string; title?: string }>;
  const hero = sessions.find((session) => session.title?.includes('Enterprise Beta Launch Review'));
  return hero?.id ?? sessions[0]?.id;
}

async function endCard(page: Page) {
  await page.evaluate(() => {
    document.getElementById('hearth-demo-caption')?.remove();
    document.getElementById('hearth-demo-progress')?.remove();
    const end = document.createElement('div');
    end.id = 'hearth-demo-endcard';
    end.innerHTML = `
      <div class="end-inner">
        <div class="end-brand"><span class="end-mark">H</span><span>Hearth</span></div>
        <h1>Make your AI power users' breakthroughs your team's starting point.</h1>
        <p>Open-source AI workspace for teams: shared workflows, org-owned memory, decisions, tasks, routines, and governance.</p>
        <div class="end-cta">Self-host it. Bring your own models. Own the memory layer.</div>
      </div>
    `;
    document.body.appendChild(end);
  });
  await pace(page, 5000);
}

test.describe.configure({ mode: 'serial' });

test.describe('Hearth GTM demo video', () => {
  test('records the breakthrough-to-team-infrastructure story', async ({ page }) => {
    test.setTimeout(180_000);

    await loginAs(page, 'admin');

    const sessionId = await findDemoSessionId(page);
    expect(sessionId, 'Run pnpm seed:gtm-demo before recording the GTM video').toBeTruthy();

    await gotoApp(page, `/chat/${sessionId}`);
    await showCaption(page, {
      scene: 1,
      eyebrow: 'The problem',
      headline: "Your best AI work is trapped in one teammate's chat.",
      body: 'Most teams already have AI power users. The leverage just does not spread.',
    }, 3300);
    await spotlight(page, 'Enterprise Beta Launch Review');
    await showCaption(page, {
      scene: 2,
      eyebrow: 'The breakthrough',
      headline: 'One power user pulls the launch together.',
      body: 'Hearth connects the chat to launch notes, Slack feedback, meeting notes, GitHub, tasks, and decisions.',
    }, 3600);
    await page.mouse.wheel(0, 420);
    await pace(page, 1200);
    await spotlight(page, 'saved "Enterprise Launch Review"');

    await gotoApp(page, '/tasks');
    await showCaption(page, {
      scene: 3,
      eyebrow: 'Work becomes visible',
      headline: 'The follow-up becomes work, not vibes.',
      body: 'The AI-generated next steps land on the shared board with owners, priorities, comments, and execution state.',
    }, 3600);
    await spotlight(page, 'Implement audit-log export for admins');
    await page.mouse.wheel(520, 0);
    await pace(page, 1000);

    await gotoApp(page, '/skills');
    await showCaption(page, {
      scene: 4,
      eyebrow: 'Pattern becomes reusable',
      headline: "The workflow becomes the team's starting point.",
      body: 'The launch review is no longer a one-off conversation. It is a reusable skill the whole team can install and improve.',
    }, 3600);
    await spotlight(page, 'Enterprise Launch Review');
    await spotlight(page, 'Security FAQ Builder');

    await gotoApp(page, '/routines');
    await showCaption(page, {
      scene: 5,
      eyebrow: 'Recurring work runs itself',
      headline: 'The weekly loop becomes a routine.',
      body: 'Launch-risk digests, procurement readiness checks, and customer-feedback triage keep moving without another blank prompt.',
    }, 3600);
    await spotlight(page, 'Monday Launch Risk Digest');

    await gotoApp(page, '/activity');
    await showCaption(page, {
      scene: 6,
      eyebrow: 'Team adoption',
      headline: 'The rest of the team can discover what works.',
      body: 'Activity turns useful AI work into something teammates can find, install, reuse, and build on.',
    }, 3600);
    await spotlight(page, 'Enterprise Launch Review');
    await page.mouse.wheel(0, 420);
    await pace(page, 1000);

    await gotoApp(page, '/memory');
    await showCaption(page, {
      scene: 7,
      eyebrow: 'Org-owned memory',
      headline: 'The company keeps the context.',
      body: "Launch precedents, customer concerns, and workflow learnings stay in Hearth instead of a model provider's chat history.",
    }, 3600);
    await spotlight(page, 'Enterprise Launch Review workflow is the standard starting point');

    await gotoApp(page, '/decisions');
    await showCaption(page, {
      scene: 8,
      eyebrow: 'Decision memory',
      headline: 'Decisions stop evaporating after the meeting.',
      body: 'Hearth preserves the rationale, alternatives, owners, and links behind the work.',
    }, 3600);
    await spotlight(page, 'Gate enterprise beta expansion');
    await spotlight(page, 'Include tool-call metadata');

    await gotoApp(page, '/settings/compliance');
    await showCaption(page, {
      scene: 9,
      eyebrow: 'The buyer objection',
      headline: 'Govern AI without locking it down.',
      body: 'Self-host it. Bring your own models. Scrub sensitive data before it reaches external LLMs.',
    }, 3800);
    await spotlight(page, 'PII (Personally Identifiable Information)');
    await page.mouse.wheel(0, 620);
    await pace(page, 1200);
    await spotlight(page, 'Scrubbing Statistics');

    await endCard(page);
  });
});
