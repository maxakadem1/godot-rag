/**
 * The Godot Engine logo, from the default project icon.svg (1024-unit space).
 * Logo by Andrea Calabró, CC BY 4.0. This project is not affiliated with Godot.
 */
export const GODOT_LOGO = {
  /** Head and jaw: the blue part. Two subpaths with the mouth gap between them. */
  body: "m105 673 152 14q12 1 15 14l4 67 132 10 8-61q2-11 15-15h162q13 4 15 15l8 61 132-10 4-67q3-13 15-14l152-14V427q30-39 56-81-35-59-83-108-43 20-82 47-40-37-88-64 7-51 8-102-59-28-123-42-26 43-46 89-49-7-98 0-20-46-46-89-64 14-123 42 1 51 8 102-48 27-88 64-39-27-82-47-48 49-83 108 26 42 56 81zm0 33v39c0 276 813 276 814 0v-39l-134 12-5 69q-2 10-14 13l-162 11q-12 0-16-11l-10-65H446l-10 65q-4 11-16 11l-162-11q-12-3-14-13l-5-69z",
  /** White band seen through the mouth gap. */
  band: "M105 673v33q407 354 814 0v-33z",
  nose: "M483 600c0 34 58 34 58 0v-86c0-34-58-34-58 0z",
  eyes: [
    { cx: 299, cy: 526, r: 90 },
    { cx: 725, cy: 526, r: 90 },
  ],
  pupils: [
    { cx: 307, cy: 532, r: 60 },
    { cx: 717, cy: 532, r: 60 },
  ],
  blue: "#478cbf",
  attribution: "Godot logo by Andrea Calabró, CC BY 4.0",
} as const;
