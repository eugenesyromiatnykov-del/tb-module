// Districts (дільниці) are sub-groupings of villages WITHIN an ambulatory
// area — they are NOT the same as locations (амбулаторії). One ambulatory
// can cover several districts, each made up of several villages. The
// /patients filter lets the doctor pick a district as a shortcut for
// selecting all of its villages at once.

export type District = {
  id: string;
  label: string;
  villages: string[];
};

export const DISTRICTS: District[] = [
  {
    id: 'zaluzka',
    label: 'Залузька Дільниця',
    villages: [
      'Залужжя',
      'Корниця',
      'Коритне',
      'Ювківці',
      'Надишень',
      'Вікнини',
      'Вікентове',
      'Шельвів',
      'Дзвінки',
    ],
  },
];
