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
  {
    id: 'okopska',
    label: 'Окопська Дільниця',
    villages: ['Окіп'],
  },
  {
    id: 'kvitnevska',
    label: 'Квітневська Дільниця',
    villages: ['Квітневе', 'Весняне', 'Соснівочка'],
  },
  {
    id: 'snosnivska',
    label: 'Соснівська Дільниця',
    villages: ['Соснівка'],
  },
  {
    id: 'mokrovolianska',
    label: 'Мокроволянська Дільниця',
    villages: ['Мокроволя'],
  },
  {
    id: 'zhemelinetska',
    label: 'Жемелинецька Дільниця',
    villages: ['Жемелинці'],
  },
  {
    id: 'hulivetska',
    label: 'Гулівецька Дільниця',
    villages: ['Гулівці', 'Жижниківці', 'Синютки'],
  },
  {
    id: 'danylivska',
    label: 'Данилівська Дільниця',
    villages: ['Денисівка', 'Данилівка', 'Калинівка'],
  },
];
