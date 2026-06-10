/** Sheet mirrors grownv1.Sheet (proto snake_case via the gateway). */
export interface Sheet {
  id: string;
  org_id: string;
  owner_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** Workbook JSON (FortuneSheet model); only present from GetSheet. */
  data?: string;
}

export interface ListSheetsResponse {
  sheets: Sheet[];
}
