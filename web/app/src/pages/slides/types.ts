/** Deck mirrors grownv1.Deck (proto snake_case via the gateway). */
export interface Deck {
  id: string;
  org_id: string;
  owner_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** Deck JSON (slides model); only present from GetDeck. */
  data?: string;
}

export interface ListDecksResponse {
  decks: Deck[];
}
