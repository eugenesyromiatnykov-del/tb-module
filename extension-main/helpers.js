// ============================================================================
// HELPERS.JS
// ============================================================================

function log(message, type = 'info') {
  const colors = { info: '#667eea', success: '#28a745', warning: '#ffc107', error: '#dc3545' };
  console.log(`%c[Medics] ${message}`, `color: ${colors[type] || '#333'}`);
}

// Поиск листового элемента по тексту — ограничен значимыми тегами
function findElementByText(text) {
  const els = document.querySelectorAll('p, span, div, label, td, th, li');
  for (const el of els) {
    if (el.children.length === 0 && el.textContent.includes(text)) return el;
  }
  return null;
}

function findElementsByText(text) {
  const results = [];
  const els = document.querySelectorAll('p, span, div, label, td, th, li');
  for (const el of els) {
    if (el.children.length === 0 && el.textContent.includes(text)) results.push(el);
  }
  return results;
}

// DD.MM.YYYY или украинский формат → Date
function parseDate(dateStr) {
  if (!dateStr) return null;

  const matchDots = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (matchDots) {
    const [, day, month, year] = matchDots;
    return new Date(+year, +month - 1, +day);
  }

  const matchUkr = dateStr.match(/(\d{1,2})\s+([а-яА-ЯіІїЇєЄ]+)\.?\s+(\d{4})/);
  if (matchUkr) {
    const monthsUkr = {
      'січ':0,'лют':1,'бер':2,'квіт':3,'трав':4,'черв':5,
      'лип':6,'серп':7,'вер':8,'жовт':9,'лист':10,'груд':11,
    };
    const key = matchUkr[2].toLowerCase().substring(0, 4);
    const monthNum = Object.entries(monthsUkr).find(([k]) => key.startsWith(k));
    if (monthNum !== undefined) return new Date(+matchUkr[3], monthNum[1], +matchUkr[1]);
  }

  return null;
}

function calculateAge(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
}

function formatDate(date) {
  if (!date || isNaN(date.getTime())) return 'невідомо';
  return `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}.${date.getFullYear()}`;
}

console.log('[Medics Indicators] Helpers.js завантажено');
