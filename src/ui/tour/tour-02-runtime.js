/** tour 的分块：runtime。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { annotateTauriMobileSurfaces, showResponsivePage } from '../shell.js';
import { escapeHtml, createThemedTourLayer, requiredTarget, isPhone, currentMainPage, markGuidedTourSeen, guidedTourSeen } from './tour-00-targets.js';
import { removeLayer, restoreTourPresentation, positionTourPopover, positionCenteredTour, cardHtml, mainSteps, deepCleanSteps, welcomeHtml } from './tour-01-steps.js';

let activeTour = null;

export function tourError(operation, error) {
    closeGuidedTour({ restore: false });
    let layer;
    try {
        layer = createThemedTourLayer();
    } catch (themeError) {
        throw new Error(`${operation}，且无法显示错误信息：${themeError.message}`);
    }
    layer.innerHTML = `<section class="blai-tour-card blai-tour-centered" role="alertdialog" aria-modal="true" aria-labelledby="blai-tour-error-title"><p class="blai-tour-kicker">导览无法继续</p><h2 id="blai-tour-error-title">${escapeHtml(operation)}</h2><p>${escapeHtml(error instanceof Error ? error.message : error)}</p><div class="blai-tour-actions"><button type="button" data-tour-action="close-error">关闭</button></div></section>`;
    annotateTauriMobileSurfaces();
    positionCenteredTour(layer.querySelector('.blai-tour-card'));
    layer.querySelector('button')?.focus();
    layer.addEventListener('click', (event) => {
        if (event.target.closest('[data-tour-action="close-error"]')) layer.remove();
    });
}

export function closeGuidedTour({ restore = true } = {}) {
    const tour = activeTour;
    activeTour = null;
    window.removeEventListener('resize', onTourResize);
    document.removeEventListener('keydown', onTourKeydown, true);
    removeLayer();
    if (!tour) return;
    if (restore) restoreTourPresentation(tour);
    if (tour.launcher?.isConnected) tour.launcher.focus();
}

function onTourResize() {
    try {
        positionActiveTour();
    } catch (error) {
        tourError(`${activeTour?.kind === 'deep-clean' ? '深度净化' : 'Veridis Rewrite'} 导览无法继续`, error);
    }
}

export function activeMainTourTarget(step) {
    const target = requiredTarget(step);
    if (activeTour?.kind !== 'main' || !step.page) return target;
    const activePage = document.querySelector('#blai-purifier-popup .page-panel.active');
    const persistentSurface = target.closest('#blai-purifier-popup .bottom-nav, #blai-purifier-popup .blai-global-header, #blai-purifier-popup .rail');
    if (target.closest('#blai-purifier-popup .page-panel') !== activePage && !persistentSurface) {
        throw new Error(`「${step.title}」未定位到当前页面中的目标。`);
    }
    return target;
}

function phoneTourScrollOwner(target) {
    if (activeTour?.kind === 'main') {
        const activePage = document.querySelector('#blai-purifier-popup .page-panel.active');
        return target.closest('#blai-purifier-popup .page-panel') === activePage ? activePage : null;
    }
    if (activeTour?.kind === 'deep-clean') {
        return target.closest('#blai-deep-clean-workspace .blai-deep-clean-selection-scroll');
    }
    return null;
}

function scrollPhoneTourTargetIntoView(target, card) {
    const scrollOwner = phoneTourScrollOwner(target);
    if (!scrollOwner) return;
    const targetRect = target.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const ownerRect = scrollOwner.getBoundingClientRect();
    const padding = 12;
    let visibleTop = ownerRect.top + padding;
    let visibleBottom = Math.min(ownerRect.bottom - padding, cardRect.top - padding);
    if (visibleBottom <= visibleTop) {
        visibleTop = Math.max(ownerRect.top + padding, cardRect.bottom + padding);
        visibleBottom = ownerRect.bottom - padding;
    }
    if (visibleBottom <= visibleTop) return;
    const visibleHeight = visibleBottom - visibleTop;
    const delta = targetRect.height > visibleHeight
        ? (targetRect.bottom <= visibleTop || targetRect.top >= visibleBottom
            ? targetRect.top - visibleTop
            : 0)
        : (targetRect.top < visibleTop
            ? targetRect.top - visibleTop
            : (targetRect.bottom > visibleBottom ? targetRect.bottom - visibleBottom : 0));
    if (delta) scrollOwner.scrollTop += delta;
}

export function positionActiveTour() {
    if (!activeTour || activeTour.phase !== 'tour') return;
    const layer = document.getElementById('blai-tour-layer');
    const card = layer?.querySelector('.blai-tour-card');
    const step = activeTour.steps[activeTour.index];
    if (!layer || !card) return;
    const target = step.previewTarget ? requiredTarget(step) : (!step.centered && !step.preview ? activeMainTourTarget(step) : null);
    if (!target) {
        // 居中步骤（完成页 / preview）不挂目标，但仍必须把卡片夹在视口内。
        positionCenteredTour(card);
        return;
    }
    if (isPhone()) scrollPhoneTourTargetIntoView(target, card);
    const rect = target.getBoundingClientRect();
    const pad = 8;
    const spotlight = layer.querySelector('.blai-tour-spotlight');
    spotlight.style.left = `${Math.max(0, rect.left - pad)}px`;
    spotlight.style.top = `${Math.max(0, rect.top - pad)}px`;
    spotlight.style.width = `${Math.min(window.innerWidth, rect.width + pad * 2)}px`;
    spotlight.style.height = `${Math.min(window.innerHeight, rect.height + pad * 2)}px`;
    positionTourPopover(card, rect);
}

export function renderActiveTourStep() {
    const { steps, index } = activeTour;
    const step = steps[index];
    if (step.page) showResponsivePage(step.page);
    const layer = document.getElementById('blai-tour-layer');
    layer.innerHTML = '<div class="blai-tour-spotlight" aria-hidden="true"></div>' + cardHtml(step, index, steps.length);
    annotateTauriMobileSurfaces();
    const target = step.previewTarget ? requiredTarget(step) : (!step.centered && !step.preview ? activeMainTourTarget(step) : null);
    layer.classList.toggle('blai-tour-has-spotlight', Boolean(target));
    if (target && !isPhone()) target.scrollIntoView({ block: 'center', inline: 'nearest' });
    positionActiveTour();
    layer.querySelector('[data-tour-action="next"], [data-tour-action="finish"], [data-tour-action="previous"]:not(:disabled)')?.focus();
    return target;
}

export function startTour(kind, launcher, firstUse) {
    removeLayer();
    const steps = kind === 'main' ? mainSteps : deepCleanSteps;
    activeTour = {
        kind,
        steps,
        index: 0,
        phase: 'tour',
        launcher,
        firstUse,
        manual: !firstUse,
        previousPage: kind === 'main' ? currentMainPage() : '',
    };
    const layer = createThemedTourLayer();
    layer.addEventListener('click', onTourClick);
    window.addEventListener('resize', onTourResize);
    document.addEventListener('keydown', onTourKeydown, true);
    renderActiveTourStep();
}

export function finishOrSkip() {
    if (activeTour?.firstUse) markGuidedTourSeen(activeTour.kind);
    closeGuidedTour();
}

function onTourKeydown(event) {
    if (event.key === 'Escape') {
        event.preventDefault();
        finishOrSkip();
        return;
    }
    if (event.key !== 'Tab') return;
    const layer = document.getElementById('blai-tour-layer');
    const focusable = Array.from(layer?.querySelectorAll('button:not(:disabled), [contenteditable="true"]') || []);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !layer.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
    }
}

export function onTourClick(event) {
    const action = event.target.closest('[data-tour-action]')?.getAttribute('data-tour-action');
    try {
        if (action === 'previous' && activeTour.index > 0) { activeTour.index -= 1; renderActiveTourStep(); return; }
        if (action === 'next') { activeTour.index += 1; renderActiveTourStep(); return; }
        if (action === 'start') { startTour(activeTour.kind, activeTour.launcher, true); return; }
    } catch (error) {
        tourError(`${activeTour?.kind === 'deep-clean' ? '深度净化' : 'Veridis Rewrite'} 导览无法继续`, error);
        return;
    }
    if (action === 'finish' || action === 'skip') { finishOrSkip(); return; }
    if (action === 'direct') { if (activeTour?.firstUse) markGuidedTourSeen(activeTour.kind); closeGuidedTour(); return; }
}

export function showWelcome(kind, launcher) {
    closeGuidedTour({ restore: false });
    activeTour = { kind, phase: 'welcome', launcher, firstUse: true };
    const layer = createThemedTourLayer();
    layer.innerHTML = welcomeHtml(kind);
    annotateTauriMobileSurfaces();
    positionCenteredTour(layer.querySelector('.blai-tour-card'));
    layer.addEventListener('click', onTourClick);
    document.addEventListener('keydown', onTourKeydown, true);
    layer.querySelector('[data-tour-action="start"]')?.focus();
}

export function offerFirstUse(kind) {
    try {
        if (guidedTourSeen(kind) === true || activeTour) return;
        showWelcome(kind, kind === 'main' ? document.getElementById('blai-tour-help') : document.getElementById('blai-deep-clean-tour-help'));
    } catch (error) {
        tourError(`${kind === 'main' ? 'Veridis Rewrite' : '深度净化'} 首次导览无法显示`, error);
    }
}

export function offerMainTourFirstUse() {
    offerFirstUse('main');
}

export function offerDeepCleanTourFirstUse() {
    offerFirstUse('deep-clean');
}

export function bindTourEvents() {
    $(document).off('click', '#blai-tour-help').on('click', '#blai-tour-help', function() {
        try { startTour('main', this, false); } catch (error) { tourError('Veridis Rewrite 界面导览无法开始', error); }
    });
    $(document).off('click', '#blai-deep-clean-tour-help').on('click', '#blai-deep-clean-tour-help', function() {
        try { startTour('deep-clean', this, false); } catch (error) { tourError('深度净化导览无法开始', error); }
    });
}

