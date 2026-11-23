/**
 * Segmentation models the editor can run in the browser. The files are self-hosted under
 * /models (see scripts/setup-ai.mjs); images never leave the user's machine.
 */
export interface SegmentationModel {
  id: string;
  label: string;
  /** Path under the site root. */
  url: string;
  bytes: number;
  /** Square input resolution the network expects. */
  inputSize: number;
  mean: [number, number, number];
  std: [number, number, number];
  license: string;
  source: string;
  sha256: string;
  note: string;
}

const IMAGENET_MEAN: [number, number, number] = [0.485, 0.456, 0.406];
const IMAGENET_STD: [number, number, number] = [0.229, 0.224, 0.225];

export const MODELS = {
  u2netp: {
    id: 'u2netp',
    label: 'Fast',
    url: '/models/u2netp.onnx',
    bytes: 4_574_861,
    inputSize: 320,
    mean: IMAGENET_MEAN,
    std: IMAGENET_STD,
    license: 'Apache-2.0',
    source: 'U²-Net (Qin et al., 2020), ONNX export distributed with rembg',
    sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    note: 'Small and quick. Good for a clear subject on a simple background.',
  },
  silueta: {
    id: 'silueta',
    label: 'Balanced',
    url: '/models/silueta.onnx',
    bytes: 44_173_029,
    inputSize: 320,
    mean: IMAGENET_MEAN,
    std: IMAGENET_STD,
    license: 'Apache-2.0 (U²-Net weights, size-reduced by the rembg project)',
    source: 'rembg "silueta" (reduced U²-Net)',
    sha256: '75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb',
    note: 'Noticeably more accurate than Fast on busy scenes.',
  },
  'isnet-general-use': {
    id: 'isnet-general-use',
    label: 'Detailed',
    url: '/models/isnet-general-use.onnx',
    bytes: 178_648_008,
    inputSize: 1024,
    mean: [0.5, 0.5, 0.5],
    std: [1, 1, 1],
    license: 'Apache-2.0',
    source: 'IS-Net / DIS (Qin et al., 2022), ONNX export distributed with rembg',
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
    note: 'Sharpest edges and fine detail, but a large download and much slower.',
  },
} satisfies Record<string, SegmentationModel>;

export type ModelId = keyof typeof MODELS;

/**
 * The model behind "click an object": given a point, it finds the object there. It comes as two
 * files that work as a pair (one studies the picture once, the other answers each click).
 */
export const OBJECT_MODEL = {
  label: 'Object finder',
  encoderUrl: '/models/slimsam-encoder.onnx',
  decoderUrl: '/models/slimsam-decoder.onnx',
  encoderBytes: 8_882_165,
  decoderBytes: 4_903_810,
  /** Square input resolution; the picture is fitted into its top-left corner. */
  inputSize: 1024,
  mean: IMAGENET_MEAN,
  std: IMAGENET_STD,
  license: 'Apache-2.0',
  source: 'SlimSAM-77 (Chen et al., 2023), a compressed Segment Anything model; 8-bit ONNX export by Xenova',
  encoderSha256: 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971',
  decoderSha256: 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2',
};
