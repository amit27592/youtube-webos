// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/features/sponsorblock.js

import { configRead } from '../config';
import { barTypes, type Segment } from './segments';
import './overlay.css';

/**
 * Draws the coloured segment bar over the player's progress bar.
 *
 * YouTube TV has shipped two player layouts, and they need different
 * treatment:
 *
 * - **Classic** — the progress bar is an `[idomkey=progress-bar]` tree. The
 *   overlay is appended inside it and positioned entirely by `./overlay.css`,
 *   so it follows the bar as it grows on focus and as chapter markers change
 *   its layout.
 * - **Modern** — an `ytlr-redux-connect-ytlr-progress-bar` custom element with
 *   no such structure. The overlay is appended to the container and positioned
 *   from `getBoundingClientRect` measurements, which is what TizenTube does
 *   throughout.
 *
 * The two are mutually exclusive: measurements are only applied on the modern
 * path, so they never fight the stylesheet.
 */

const CLASSIC_CONTAINER = '[idomkey=progress-bar]';
const MODERN_CONTAINER = 'ytlr-redux-connect-ytlr-progress-bar';
const SLIDER = 'div[idomkey="slider"]';

/** Present only in the modern player layout. */
const MODERN_MARKER = 'div[idomkey="Metadata-Section"]';

type Layout = 'classic' | 'modern';

interface Attachment {
  layout: Layout;
  /** The element the overlay is appended to. */
  container: Element;
  /** The element mutations are watched on. */
  observed: Element;
}

export class SegmentOverlay {
  #element: HTMLDivElement | null = null;
  #attachment: Attachment | null = null;
  #observer: MutationObserver | null = null;
  #findInterval: ReturnType<typeof setInterval> | null = null;
  #destroyed = false;

  constructor(
    private readonly segments: readonly Segment[],
    private readonly duration: number
  ) {}

  build() {
    if (this.#element || this.#destroyed) return;
    if (!(this.duration > 0)) return;

    const element = document.createElement('div');
    element.className = 'ytaf-sponsorblock-segment-container';

    const showHighlight = configRead('enableSponsorBlockHighlight');

    for (const segment of this.segments) {
      if (segment.category === 'poi_highlight' && !showHighlight) continue;

      const [start, end] = segment.segment;
      const barType = barTypes[segment.category];

      const bar = document.createElement('div');
      bar.className = 'ytaf-sponsorblock-segment';
      bar.style.setProperty(
        'background-color',
        barType?.color ?? 'blue',
        'important'
      );
      bar.style.setProperty('opacity', barType?.opacity ?? '0.7', 'important');
      bar.style.setProperty(
        'left',
        `${(start / this.duration) * 100}%`,
        'important'
      );
      // A highlight is a point, not a range, so it gets a fixed hairline width
      // rather than one derived from its (near-zero) duration.
      bar.style.setProperty(
        'width',
        segment.category === 'poi_highlight'
          ? '1%'
          : `${((end - start) / this.duration) * 100}%`,
        'important'
      );

      element.appendChild(bar);
    }

    this.#element = element;
    this.#observer = new MutationObserver(() => this.#onMutation());

    this.#watchForContainer();
  }

  /** Re-measures the modern layout. Cheap and a no-op on the classic one. */
  reposition() {
    const element = this.#element;
    if (!element || this.#attachment?.layout !== 'modern') return;

    const slider = document.querySelector(SLIDER);
    const rect = slider?.getBoundingClientRect();
    if (!rect) return;

    // The modern layout only needs a vertical anchor once the player chrome has
    // settled; the horizontal extent is fixed by the styles applied on attach.
    if (!document.querySelector(MODERN_MARKER)) {
      element.style.setProperty('top', `${rect.top}px`, 'important');
    }
  }

  #watchForContainer() {
    if (this.#findInterval) clearInterval(this.#findInterval);

    const attempt = () => {
      if (this.#destroyed) return;

      const attachment = findAttachment();
      if (!attachment) return;

      if (this.#findInterval) {
        clearInterval(this.#findInterval);
        this.#findInterval = null;
      }

      this.#attach(attachment);
    };

    attempt();
    if (!this.#attachment && !this.#destroyed) {
      this.#findInterval = setInterval(attempt, 250);
    }
  }

  #attach(attachment: Attachment) {
    const element = this.#element;
    if (!element) return;

    this.#attachment = attachment;

    if (attachment.layout === 'modern') {
      this.#applyModernStyles(attachment.container);
    }

    attachment.container.appendChild(element);
    this.#observer?.observe(attachment.observed, {
      childList: true,
      subtree: true
    });

    console.info(
      '[sponsorblock] Overlay attached,',
      attachment.layout,
      'layout'
    );
  }

  /**
   * The modern progress bar carries its geometry in classes rather than in a
   * structure we can nest into, so the overlay copies them and is sized from
   * the slider's measured height.
   */
  #applyModernStyles(container: Element) {
    const element = this.#element;
    if (!element) return;

    element.classList.add(
      'ytLrProgressBarSlider',
      'ytLrProgressBarSliderRectangularProgressBar'
    );
    element.style.setProperty('z-index', '10', 'important');
    element.style.setProperty(
      'background-color',
      'rgba(0, 0, 0, 0)',
      'important'
    );
    element.style.setProperty('width', '72rem', 'important');
    element.style.setProperty('left', '4rem', 'important');

    const slider =
      container.querySelector(SLIDER) ?? document.querySelector(SLIDER);
    if (!slider || slider.classList.contains('ytLrProgressBarSlider')) return;

    for (const className of slider.classList) element.classList.add(className);

    const rect = slider.getBoundingClientRect();
    element.style.setProperty('height', `${rect.height}px`, 'important');
    element.style.setProperty(
      'bottom',
      `${rect.bottom - rect.top}px`,
      'important'
    );
  }

  #onMutation() {
    const element = this.#element;
    const attachment = this.#attachment;
    if (!element || !attachment) return;

    // YouTube re-renders the progress bar on its own schedule and takes our
    // overlay with it. Reattach rather than assuming it survives.
    if (!element.isConnected) {
      if (attachment.container.isConnected) {
        attachment.container.appendChild(element);
      } else {
        console.info('[sponsorblock] Progress bar replaced, finding it again');
        this.#observer?.disconnect();
        this.#attachment = null;
        this.#watchForContainer();
      }
      return;
    }

    // Hide the overlay while the progress bar is not interactive, so it does
    // not float over the video on its own.
    const bar = document.querySelector('ytlr-progress-bar');
    if (bar) {
      const visible = bar.getAttribute('hybridnavfocusable') !== 'false';
      element.style.setProperty(
        'display',
        visible ? 'block' : 'none',
        'important'
      );
    }
  }

  destroy() {
    this.#destroyed = true;

    if (this.#findInterval) {
      clearInterval(this.#findInterval);
      this.#findInterval = null;
    }

    this.#observer?.disconnect();
    this.#observer = null;

    this.#element?.remove();
    this.#element = null;
    this.#attachment = null;
  }
}

/**
 * Finds where to hang the overlay.
 *
 * The classic layout renders two or three `[idomkey=progress-bar]` nodes
 * depending on whether the video has chapter markers; the last one is the live
 * bar.
 */
function findAttachment(): Attachment | null {
  const bars = document.querySelectorAll(CLASSIC_CONTAINER);
  const last = bars[bars.length - 1];

  if (last) {
    // Three nodes means chapter markers, and the bar itself is the right
    // parent. Two means a plain bar, whose slider is.
    const container =
      bars.length === 3
        ? last
        : (last.querySelector('[idomkey=slider]') ?? null);

    if (container) return { layout: 'classic', container, observed: last };
  }

  const modern = document.querySelector(MODERN_CONTAINER);
  if (modern) return { layout: 'modern', container: modern, observed: modern };

  return null;
}
