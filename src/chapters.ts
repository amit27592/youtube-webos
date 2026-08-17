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
 * YouTube TV does not render chapters itself, but its player understands the
 * `macroMarkersListEntity` its phone and web clients use, so we can build one
 * and hand it over.
 *
 * TizenTube's version reads the description out of the watch-next response's
 * `videoMetadataRenderer`, and is disabled in their tree because YouTube
 * stopped populating it. We read `videoDetails.shortDescription` from the
 * player response instead, which is where the description still lives, and
 * deliver the entity through `resolveCommand` rather than by mutating a
 * response -- so this does not depend on the shape of the watch-next payload
 * at all.
 */

export interface Chapter {
  /** Milliseconds from the start of the video. */
  time: number;
  name: string;
}

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
  const key = `${videoID}-key`;

  return {
    entityKey: key,
    type: 'ENTITY_MUTATION_TYPE_REPLACE',
    payload: {
      macroMarkersListEntity: {
        key,
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

/** Descriptions by video ID, harvested from player responses. */
const descriptions = new Map<string, string>();

addJsonParseHandler('chapters', (value) => {
  if (typeof value !== 'object' || value === null) return;

  const details = (value as { videoDetails?: Record<string, unknown> })
    .videoDetails;
  if (!details) return;

  const { videoId, shortDescription } = details;

  if (typeof videoId === 'string' && typeof shortDescription === 'string') {
    descriptions.set(videoId, shortDescription);
  }
});

async function publishChapters(videoID: string, durationMs: number) {
  const description = descriptions.get(videoID);
  if (!description) return;

  const chapters = parseTimestamps(description);
  if (chapters.length === 0) return;

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

    published = videoID;
    void publishChapters(videoID, video.duration * 1000);
  };

  manager.addEventListener('newVideo', publish);
  manager.addEventListener('playbackStart', publish);
  video.addEventListener('durationchange', publish);
}

void start();
