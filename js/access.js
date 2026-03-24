/**
 * access.js — Gestion des droits d'accès à la capsule
 */

import { getAccessList, addAccessPerson, removeAccessPerson, showToast } from './app.js';

const ROLES = {
    soignant: { label: 'Soignant(e)', badge: 'badge-soignant' },
    confiance: { label: 'Personne de confiance', badge: 'badge-confiance' },
    famille: { label: 'Famille', badge: 'badge-famille' }
};

export async function renderAccessList(containerEl) {
    const list = await getAccessList();
    containerEl.innerHTML = '';

    if (list.length === 0) {
        containerEl.innerHTML = `
      <div class="video-empty" style="height:120px;">
        <p>Aucun accès défini.<br>Ajoutez une personne ci-dessous.</p>
      </div>`;
        return;
    }

    list.forEach(person => {
        const role = ROLES[person.role] || { label: person.role, badge: 'badge-soignant' };
        const initials = person.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const el = document.createElement('div');
        el.className = 'access-person';
        el.innerHTML = `
      <div class="avatar">${initials}</div>
      <div class="access-info">
        <div class="name">${escHtml(person.name)}</div>
        <div class="contact">${escHtml(person.contact || '')}</div>
        <span class="access-badge ${role.badge} mt-8">${role.label}</span>
      </div>
      <button class="btn btn-danger btn-sm" data-id="${person.id}" title="Révoquer l'accès">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
          <path d="M2.5 1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1H3v9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4h.5a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1H2.5zm3 4a.5.5 0 0 1 1 0v6a.5.5 0 0 1-1 0V5zm2.5 0a.5.5 0 0 1 1 0v6a.5.5 0 0 1-1 0V5z"/>
        </svg>
      </button>`;

        el.querySelector('button').addEventListener('click', async () => {
            if (confirm(`Révoquer l'accès de ${person.name} ?`)) {
                await removeAccessPerson(person.id);
                showToast(`Accès de ${person.name} révoqué.`);
                renderAccessList(containerEl);
            }
        });

        containerEl.appendChild(el);
    });
}

export async function handleAddPerson(form, listContainer) {
    const name = form.querySelector('#acc-name').value.trim();
    const role = form.querySelector('#acc-role').value;
    const contact = form.querySelector('#acc-contact').value.trim();

    if (!name) { showToast('Veuillez saisir un nom.'); return; }
    if (!role) { showToast('Veuillez choisir un rôle.'); return; }

    await addAccessPerson({ name, role, contact, addedAt: new Date().toISOString() });
    showToast(`✅ ${name} ajouté(e) avec succès.`);
    form.reset();
    renderAccessList(listContainer);
}

function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
