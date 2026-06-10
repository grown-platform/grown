/** Photo mirrors grownv1.Photo (proto snake_case via the gateway). */
export interface Photo {
  id: string;
  org_id: string;
  owner_id: string;
  filename: string;
  content_type: string;
  size: number;
  width: number;
  height: number;
  description: string;
  favorite: boolean;
  content_url: string;
  created_at: string;
  updated_at: string;
}

/** Album mirrors grownv1.Album. `photos` is only populated by GetAlbum. */
export interface Album {
  id: string;
  org_id: string;
  owner_id: string;
  title: string;
  cover_photo_id: string;
  cover_url: string;
  photo_count: number;
  created_at: string;
  updated_at: string;
  photos?: Photo[];
}

export interface ListPhotosResponse {
  photos: Photo[];
}

export interface ListAlbumsResponse {
  albums: Album[];
}

/** UpdatePhotoInput is the editable subset sent on photo update. */
export interface UpdatePhotoInput {
  description: string;
  favorite: boolean;
}
