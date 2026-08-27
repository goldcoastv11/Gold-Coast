/**
 * Skin catalog - server-side copy of casino-poc/src/GameState.ts's
 * SKIN_CATALOG (the client has no server package to import from, so this is
 * a deliberate duplication, not a divergent source of truth). Keep this in
 * sync with the client's SKIN_CATALOG by hand until/unless the two share a
 * package - ids and prices below are copied verbatim.
 */

export interface SkinDef {
  id: string;
  textureKey: string;
  name: string;
  price: number; // 0 = free/default
}

export const SKIN_CATALOG: readonly SkinDef[] = [
  { id: "player", textureKey: "player_flat_sheet", name: "Classic", price: 0 },
  { id: "skin_000", textureKey: "skin_000", name: "Outfit 1", price: 400 },
  { id: "skin_001", textureKey: "skin_001", name: "Outfit 2", price: 250 },
  { id: "skin_002", textureKey: "skin_002", name: "Outfit 3", price: 1000 },
  { id: "skin_003", textureKey: "skin_003", name: "Outfit 4", price: 900 },
  { id: "skin_004", textureKey: "skin_004", name: "Outfit 5", price: 900 },
  { id: "skin_005", textureKey: "skin_005", name: "Outfit 6", price: 500 },
  { id: "skin_006", textureKey: "skin_006", name: "Outfit 7", price: 400 },
  { id: "skin_007", textureKey: "skin_007", name: "Outfit 8", price: 350 },
  { id: "skin_008", textureKey: "skin_008", name: "Outfit 9", price: 2500 },
  { id: "skin_009", textureKey: "skin_009", name: "Outfit 10", price: 300 },
  { id: "skin_010", textureKey: "skin_010", name: "Outfit 11", price: 250 },
  { id: "skin_011", textureKey: "skin_011", name: "Outfit 12", price: 350 },
  { id: "skin_012", textureKey: "skin_012", name: "Outfit 13", price: 750 },
  { id: "skin_013", textureKey: "skin_013", name: "Outfit 14", price: 900 },
  { id: "skin_014", textureKey: "skin_014", name: "Outfit 15", price: 4000 },
  { id: "skin_015", textureKey: "skin_015", name: "Outfit 16", price: 250 },
  { id: "skin_016", textureKey: "skin_016", name: "Outfit 17", price: 750 }
];

export function getSkin(id: string): SkinDef | undefined {
  return SKIN_CATALOG.find((s) => s.id === id);
}
