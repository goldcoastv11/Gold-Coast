export const OUTFITS = [
  { id: 'Casual_2', name: 'Coastal casual', shirt: ['LightBrown'], hair: ['Hair', 'Eyebrows'] },
  { id: 'Casual_Hoodie', name: 'Hoodie', shirt: ['Purple'], hair: ['Hair', 'Eyebrows'] },
  { id: 'Beach', name: 'Beach', shirt: ['LightBrown'], hair: ['Hair', 'Eyebrows'] },
  { id: 'Suit', name: 'Evening suit', shirt: ['Suit'], hair: ['Hair', 'Eyebrows'] },
  { id: 'Punk', name: 'Punk', shirt: ['White'], hair: ['Red', 'Eyebrows'] },
  { id: 'Worker', name: 'Worker', shirt: ['Worker_Vest'], hair: ['Moustache', 'Eyebrows'] },
  { id: 'Farmer', name: 'Farmer', shirt: ['LightBlue'], hair: ['Eyebrows'] },
  { id: 'Adventurer', name: 'Adventurer', shirt: ['Green', 'LightGreen'], hair: ['Hair', 'Eyebrows'] },
  { id: 'King', name: 'Royal', shirt: ['Blue'], hair: ['Hair_White'] },
  { id: 'Spacesuit', name: 'Astronaut', shirt: ['SciFi_Main', 'SciFi_MainDark'], hair: [] },
  { id: 'Swat', name: 'Tactical', shirt: ['Swat'], hair: [] },
];
export const outfitFor = (id?: string) => OUTFITS.find(o => o.id === id) ?? OUTFITS[0];
