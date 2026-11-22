export interface Folder {
  generation: number;
  path: string;
  pick: string;
  photos: { name: string; format: string; pair_format: string | null }[];
}
