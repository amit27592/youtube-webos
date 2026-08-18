// Adapted from https://github.com/reisxd/TizenTube/blob/3f28fc3d/mods/ui/chapters.js

import { configRead } from './config';
import { addJsonParseHandler } from './hooks/json-parse';
import { dispatch } from './yt_ui/dispatch';
import { getPlayerManager, PlayerMode } from './player_api/manager';
import { requireElement } from './player_api/helpers';

/**
 * Chapter markers on the player scrubber, built from timestamps in the video
 * description.
 *
 * This is now a fallback. YouTube TV ships and renders its own
 * `macroMarkersListEntity` for videos whose chapters it recognises, so for most
 * chaptered videos there is nothing for us to do -- and doing it anyway would
 * mean two sets of markers for one video. We stand in only where YouTube sent
 * no chapters of its own but the description says otherwise, which is where its
 * rules are stricter than ours: it wants at least three chapters, each at least
 * ten seconds long.
 *
 * The description comes out of the watch-next response's description panel.
 * TizenTube reads `videoMetadataRenderer` and is disabled in their tree because
 * YouTube stopped populating it; `videoDetails.shortDescription` on the player
 * response, which this used to read, has since gone the same way.
 *
 * Publishing takes both routes open to us: the marker bar is asked for by
 * mutating the response, because that is the only thing that creates one, and
 * the markers themselves go through `resolveCommand` afterwards, because they
 * are not known until the player reports the duration.
 */

export interface Chapter {
  /** Milliseconds from the start of the video. */
  time: number;
  name: string;
}

/**
 * The entity key YouTube publishes description chapters under -- an encoded
 * `DESCRIPTION_CHAPTERS`, and so the same string for every video, replaced as
 * each one loads.
 *
 * We publish under it too. A key of our own is not resolved by the marker bar:
 * a bar pointed at `${videoID}-key` draws nothing however the entity is
 * dispatched, while the same bar pointed here draws the chapters. Sharing the
 * key is safe because we only publish for videos YouTube found no chapters in,
 * so there is never an entity of its own here to displace.
 */
const ENTITY_KEY = 'EhRERVNDUklQVElPTl9DSEFQVEVSUyCSAigB';

/**
 * Leading timestamp on a description line: `M:SS`, `MM:SS`, or `H:MM:SS`.
 *
 * Anchored at the start of the line. TizenTube's pattern handles only the first
 * two forms, which drops every chapter past the hour mark on exactly the long
 * videos chapters matter most for.
 */
const TIMESTAMP = /^(\d+):(\d{2})(?::(\d{2}))?/;

/** Separators people put between the timestamp and the chapter title. */
const LEADING_SEPARATOR = /^[\s\-–—:|.)\]]+/;

export function parseTimestamps(description: string): Chapter[] {
  const chapters: Chapter[] = [];

  for (const line of description.split('\n')) {
    const trimmed = line.trim();
    const match = TIMESTAMP.exec(trimmed);
    if (!match) continue;

    // With three groups the timestamp is H:MM:SS; with two it is M:SS.
    const [hours, minutes, seconds] =
      match[3] === undefined
        ? [0, Number(match[1]), Number(match[2])]
        : [Number(match[1]), Number(match[2]), Number(match[3])];

    // `\d{2}` matches "99", which is not a time.
    if (minutes > 59 || seconds > 59) continue;

    const name = trimmed
      .slice(match[0].length)
      .replace(LEADING_SEPARATOR, '')
      .trim();

    if (!name) continue;

    chapters.push({
      time: (hours * 3600 + minutes * 60 + seconds) * 1000,
      name
    });
  }

  // Descriptions routinely mention times that are not chapters ("as I said at
  // 4:20..."), so require the list to look like a chapter list: at least two
  // entries, in order, starting at the beginning of the video.
  if (chapters.length < 2) return [];
  if (chapters[0]!.time !== 0) return [];

  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i]!.time <= chapters[i - 1]!.time) return [];
  }

  return chapters;
}

/**
 * `hqdefault` is one of the thumbnail names `src/thumbnail-quality.ts` knows how
 * to upgrade, so when that option is on these markers are upgraded along with
 * every other thumbnail rather than being left behind at a lower resolution.
 */
function chapterThumbnail(videoID: string) {
  return {
    thumbnails: [
      {
        url: `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg`,
        width: 320,
        height: 180
      }
    ]
  };
}

function marker(
  chapter: Chapter,
  durationMillis: number,
  videoID: string,
  index: number
) {
  const key = `${videoID}${chapter.time}${durationMillis}`;

  return {
    title: { simpleText: chapter.name },
    startMillis: String(chapter.time),
    durationMillis: String(durationMillis),
    thumbnailDetails: chapterThumbnail(videoID),
    onActive: {
      innertubeCommand: {
        clickTrackingParams: null,
        entityUpdateCommand: {
          entityBatchUpdate: {
            mutations: [
              {
                entityKey: key,
                type: 'ENTITY_MUTATION_TYPE_REPLACE',
                payload: {
                  markersEngagementPanelSyncEntity: {
                    key,
                    panelId:
                      'engagement-panel-macro-markers-description-chapters',
                    activeItemIndex: index,
                    syncEnabled: true
                  }
                }
              }
            ]
          }
        }
      }
    }
  };
}

function markerEntity(videoID: string, markers: unknown[]) {
  return {
    entityKey: ENTITY_KEY,
    type: 'ENTITY_MUTATION_TYPE_REPLACE',
    payload: {
      macroMarkersListEntity: {
        key: ENTITY_KEY,
        externalVideoId: videoID,
        markersList: {
          markerType: 'MARKER_TYPE_CHAPTERS',
          markers,
          headerTitle: { runs: [{ text: 'Chapters' }] },
          onTap: {
            innertubeCommand: {
              clickTrackingParams: null,
              changeEngagementPanelVisibilityAction: {
                targetId: 'engagement-panel-macro-markers-description-chapters',
                visibility: 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'
              }
            }
          },
          markersEdu: {
            enterNudgeText: {
              runs: [{ text: 'To view chapters, press the up arrow button' }]
            },
            enterNudgeA11yText: 'To view chapters, press the up arrow button',
            navNudgeText: { runs: [{ text: 'Navigate between chapters' }] },
            navNudgeA11yText:
              'Press the left or right arrow button to navigate between chapters'
          },
          loggingDirectives: {
            trackingParams: null,
            enableDisplayloggerExperiment: true
          }
        }
      }
    }
  };
}

// --- reading the watch-next response ---------------------------------------

interface WatchNextResponse {
  currentVideoEndpoint?: { watchEndpoint?: { videoId?: unknown } };
  engagementPanels?: {
    engagementPanelSectionListRenderer?: {
      content?: {
        structuredDescriptionContentRenderer?: {
          items?: {
            expandableVideoDescriptionBodyRenderer?: {
              descriptionBodyText?: { runs?: { text?: unknown }[] };
            };
          }[];
        };
      };
    };
  }[];
  frameworkUpdates?: {
    entityBatchUpdate?: {
      mutations?: {
        payload?: {
          macroMarkersListEntity?: {
            externalVideoId?: unknown;
            markersList?: { markerType?: unknown };
          };
        };
      }[];
    };
  };
  playerOverlays?: {
    playerOverlayRenderer?: {
      decoratedPlayerBarRenderer?: {
        decoratedPlayerBarRenderer?: {
          playerBar?: {
            multiMarkersPlayerBarRenderer?: { visibleOnLoad?: { key: string } };
          };
        };
      };
    };
  };
}

/**
 * The description, rebuilt from the runs of the description panel. Timestamps
 * are their own runs (YouTube makes them links), so only the concatenation is
 * the text the user sees.
 */
function readDescription(response: WatchNextResponse): string | undefined {
  for (const panel of response.engagementPanels ?? []) {
    const items =
      panel?.engagementPanelSectionListRenderer?.content
        ?.structuredDescriptionContentRenderer?.items;

    for (const item of items ?? []) {
      const runs =
        item?.expandableVideoDescriptionBodyRenderer?.descriptionBodyText?.runs;
      if (!Array.isArray(runs)) continue;

      const text = runs
        .map((run) => (typeof run?.text === 'string' ? run.text : ''))
        .join('');

      if (text) return text;
    }
  }

  return undefined;
}

/** Whether YouTube sent chapters of its own for this video. */
function hasNativeChapters(response: WatchNextResponse, videoID: string) {
  const mutations = response.frameworkUpdates?.entityBatchUpdate?.mutations;

  return (mutations ?? []).some((mutation) => {
    const entity = mutation?.payload?.macroMarkersListEntity;

    return (
      entity?.externalVideoId === videoID &&
      entity.markersList?.markerType === 'MARKER_TYPE_CHAPTERS'
    );
  });
}

/**
 * Asks the response for a marker bar of our own.
 *
 * `loadMarkersCommand` fills a bar in; it does not create one. The bar is built
 * from the watch-next response, and a video YouTube found no chapters in
 * arrives without one -- with no `decoratedPlayerBarRenderer` at all -- so
 * publishing an entity on its own has nothing to draw into. This asks for the
 * bar the native path would have asked for, pointed at {@link ENTITY_KEY}.
 */
function requestPlayerBar(response: WatchNextResponse) {
  const overlay = ((response.playerOverlays ??= {}).playerOverlayRenderer ??=
    {});
  const decorated = (overlay.decoratedPlayerBarRenderer ??= {});
  const bar = ((decorated.decoratedPlayerBarRenderer ??= {}).playerBar ??= {});

  bar.multiMarkersPlayerBarRenderer = { visibleOnLoad: { key: ENTITY_KEY } };
}

/**
 * Chapters by video ID, harvested from watch-next responses. Videos YouTube
 * chaptered itself are recorded with none, which is what keeps us from adding a
 * second set of markers to them.
 */
const chaptersByVideo = new Map<string, Chapter[]>();

addJsonParseHandler('chapters', (value) => {
  if (typeof value !== 'object' || value === null) return;

  const response = value as WatchNextResponse;
  const videoID = response.currentVideoEndpoint?.watchEndpoint?.videoId;
  if (typeof videoID !== 'string') return;

  const description = hasNativeChapters(response, videoID)
    ? undefined
    : readDescription(response);

  const chapters = description ? parseTimestamps(description) : [];
  chaptersByVideo.set(videoID, chapters);

  // An empty bar is worse than no bar, so only ask for one once there is
  // something to put in it.
  if (chapters.length > 0 && configRead('enableChapters'))
    requestPlayerBar(response);

  // The response can land after the player has already reported its duration,
  // in which case this is the last chance to publish.
  retryPublish?.();
});

/** Set by {@link start}: a description arriving is a reason to try again. */
let retryPublish: (() => void) | undefined;

async function publishChapters(videoID: string, durationMs: number) {
  const chapters = chaptersByVideo.get(videoID);
  if (!chapters?.length) return;

  const markers = chapters.map((chapter, index) => {
    const next = chapters[index + 1];
    const end = next ? next.time : durationMs;

    return marker(chapter, end - chapter.time, videoID, index);
  });

  const entity = markerEntity(videoID, markers);

  console.info('[chapters]', videoID, 'publishing', markers.length, 'chapters');

  await dispatch({
    clickTrackingParams: null,
    entityUpdateCommand: { entityBatchUpdate: { mutations: [entity] } }
  });

  await dispatch({
    clickTrackingParams: null,
    loadMarkersCommand: {
      visibleOnLoadKeys: [entity.entityKey],
      entityKeys: [entity.entityKey]
    }
  });
}

async function start() {
  const manager = await getPlayerManager();
  const video = await requireElement('video', HTMLVideoElement);

  let published: string | null = null;

  const publish = () => {
    const videoID = manager.currentVideoID;

    if (!configRead('enableChapters')) return;
    if (!videoID || published === videoID) return;
    if (manager.playerMode !== PlayerMode.NORMAL) return;

    // The last chapter runs to the end of the video, so nothing can be built
    // until the duration is known.
    if (!(video.duration > 0)) return;

    // Nothing has been read for this video yet: leave it for the retry the
    // parse handler makes, rather than deciding it has no chapters.
    if (!chaptersByVideo.has(videoID)) return;

    published = videoID;
    void publishChapters(videoID, video.duration * 1000);
  };

  manager.addEventListener('newVideo', publish);
  manager.addEventListener('playbackStart', publish);
  video.addEventListener('durationchange', publish);
  retryPublish = publish;
}

void start();
