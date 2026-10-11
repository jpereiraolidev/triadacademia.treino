/* ============================================================
   TRIAD ACADEMIA — script.js
   Utilitários compartilhados: tema, toast, modal, formatters.
============================================================ */

/* ============================================================
   TEMA
============================================================ */
function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  localStorage.setItem('triad_tema', next);

  const icone = document.getElementById('themeIcon');
  if (icone) icone.textContent = next === 'light' ? '🌙' : '☀️';
}

(function initTheme() {
  const saved = localStorage.getItem('triad_tema') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  // Roda depois do DOM
  window.addEventListener('DOMContentLoaded', () => {
    const icone = document.getElementById('themeIcon');
    if (icone) icone.textContent = saved === 'light' ? '🌙' : '☀️';
  });
})();

/* ============================================================
   TOAST
============================================================ */
function toast(msg, tipo = 'default', duracao = 3200) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show ' + (tipo !== 'default' ? tipo : '');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), duracao);
}

/* ============================================================
   MODAL
============================================================ */
function abrirModal(html, { wide = false } = {}) {
  let overlay = document.getElementById('modalOverlay');
  let modal = document.getElementById('modalContent');

  if (!overlay || !modal) {
    overlay = document.createElement('div');
    overlay.id = 'modalOverlay';
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => {
      if (e.target === overlay) fecharModal();
    };

    modal = document.createElement('div');
    modal.id = 'modalContent';
    modal.className = 'modal';
    modal.onclick = (e) => e.stopPropagation();

    modal.innerHTML = `
      <button class="modal-close" onclick="fecharModal()">✕</button>
      <div id="modalBody"></div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  document.getElementById('modalBody').innerHTML = html;
  modal.classList.toggle('wide', wide);
  overlay.classList.add('show');
}

function fecharModal() {
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.classList.remove('show');
}

window.abrirModal = abrirModal;
window.fecharModal = fecharModal;

/* ============================================================
   FORMATTERS
============================================================ */
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function capitalize(str) {
  if (!str) return '';
  return String(str).charAt(0).toUpperCase() + String(str).slice(1);
}

function formatarData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = (new Date() - d) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return Math.floor(diff / 60) + ' min atrás';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h atrás';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function formatarDataBR(iso) {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function formatarTempo(seg) {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function iniciaisDe(nome) {
  if (!nome) return '?';
  return nome.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/* ============================================================
   MÁSCARAS
============================================================ */
function mascaraCPF(el) {
  let v = el.value.replace(/\D/g, '').slice(0, 11);
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  el.value = v;
}

function mascaraTelefone(el) {
  let v = el.value.replace(/\D/g, '').slice(0, 11);
  if (v.length <= 10) {
    v = v.replace(/(\d{2})(\d)/, '($1) $2');
    v = v.replace(/(\d{4})(\d)/, '$1-$2');
  } else {
    v = v.replace(/(\d{2})(\d)/, '($1) $2');
    v = v.replace(/(\d{5})(\d)/, '$1-$2');
  }
  el.value = v;
}

function mascaraCEP(el) {
  let v = el.value.replace(/\D/g, '').slice(0, 8);
  v = v.replace(/(\d{5})(\d)/, '$1-$2');
  el.value = v;
}

/* ============================================================
   SLEEP
============================================================ */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* ============================================================
   QR CODE (mock SVG)
============================================================ */
function gerarQRCodeSVG(texto) {
  const size = 21, cell = 8, padding = 4;
  const total = (size + padding * 2) * cell;
  let hash = 0;
  for (let i = 0; i < texto.length; i++) {
    hash = ((hash << 5) - hash) + texto.charCodeAt(i);
    hash |= 0;
  }
  const rand = (seed) => { const x = Math.sin(seed) * 10000; return x - Math.floor(x); };
  let cells = '';
  const marcadores = [[0, 0], [size - 7, 0], [0, size - 7]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dentro = false;
      for (const [mx, my] of marcadores) {
        if (x >= mx && x < mx + 7 && y >= my && y < my + 7) {
          dentro = true;
          const dx = x - mx, dy = y - my;
          const borda = dx === 0 || dx === 6 || dy === 0 || dy === 6;
          const centro = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
          if (borda || centro) {
            cells += `<rect x="${(x + padding) * cell}" y="${(y + padding) * cell}" width="${cell}" height="${cell}" fill="#000"/>`;
          }
          break;
        }
      }
      if (dentro) continue;
      if (rand(hash + x * 31 + y * 17) > 0.5) {
        cells += `<rect x="${(x + padding) * cell}" y="${(y + padding) * cell}" width="${cell}" height="${cell}" fill="#000"/>`;
      }
    }
  }
  return `<svg width="${total}" height="${total}" viewBox="0 0 ${total} ${total}" xmlns="http://www.w3.org/2000/svg"><rect width="${total}" height="${total}" fill="#fff"/>${cells}</svg>`;
}

/* ============================================================
   EXPOR
============================================================ */
window.toggleTheme = toggleTheme;
window.toast = toast;
window.escapeHtml = escapeHtml;
window.capitalize = capitalize;
window.formatarData = formatarData;
window.formatarDataBR = formatarDataBR;
window.formatarTempo = formatarTempo;
window.iniciaisDe = iniciaisDe;
window.saudacao = saudacao;
window.mascaraCPF = mascaraCPF;
window.mascaraTelefone = mascaraTelefone;
window.mascaraCEP = mascaraCEP;
window.sleep = sleep;
window.gerarQRCodeSVG = gerarQRCodeSVG;