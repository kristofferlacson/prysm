export interface CanvasPreset {
  id: string;
  name: string;
  width: number;
  height: number;
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: 'square', name: 'Square post', width: 1080, height: 1080 },
  { id: 'portrait', name: 'Portrait post', width: 1080, height: 1350 },
  { id: 'story', name: 'Story', width: 1080, height: 1920 },
  { id: 'youtube', name: 'YouTube thumbnail', width: 1280, height: 720 },
  { id: 'facebook-cover', name: 'Facebook cover', width: 1640, height: 624 },
  { id: 'poster', name: 'Poster 18 × 24 in', width: 1800, height: 2400 },
  { id: 'album', name: 'Album cover', width: 1600, height: 1600 },
  { id: 'flyer', name: 'Flyer A5', width: 1240, height: 1748 },
  { id: 'business-card', name: 'Business card', width: 1050, height: 600 },
  { id: 'wallpaper', name: 'Desktop wallpaper', width: 1920, height: 1080 },
  { id: 'certificate', name: 'Certificate', width: 2000, height: 1414 },
];
