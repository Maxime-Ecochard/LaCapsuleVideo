/**
 * access.js — Gestion des droits d'accès à la capsule
 */

import { getAccessList, addAccessPerson, removeAccessPerson, updateAccessPerson, showToast, addHistoryEntry } from './app.js';

const ROLES = {
    soignant: { label: 'Soignant(e)', badge: 'badge-soignant' },
    confiance: { label: 'Personne de confiance', badge: 'badge-confiance' },
    famille: { label: 'Famille / Proche', badge: 'badge-famille' }
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
      <div style="display:flex; flex-direction:column; gap:8px;">
        <button class="btn btn-secondary btn-sm edit-btn" title="Modifier">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
            <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 1.586L10.5 1.793 1.415 10.879l-1.202 3.006 3.006-1.201L12.793 4.086z"/>
          </svg>
        </button>
        <button class="btn btn-danger btn-sm delete-btn" title="Révoquer l'accès">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
            <path d="M2.5 1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1H3v9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4h.5a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1H2.5zm3 4a.5.5 0 0 1 1 0v6a.5.5 0 0 1-1 0V5zm2.5 0a.5.5 0 0 1 1 0v6a.5.5 0 0 1-1 0V5z"/>
          </svg>
        </button>
      </div>`;

        el.querySelector('.delete-btn').addEventListener('click', async () => {
            if (confirm(`Révoquer l'accès de ${person.name} ?`)) {
                await removeAccessPerson(person.id);

                // Log dans l'historique
                try {
                    await addHistoryEntry({
                        type: 'access_remove',
                        details: { contactName: person.name, role: person.role }
                    });
                } catch (e) { console.warn('History log error:', e); }

                showToast(`Accès de ${person.name} révoqué.`);
                renderAccessList(containerEl);
            }
        });

        el.querySelector('.edit-btn').addEventListener('click', () => {
            editAccessPerson(person);
        });

        containerEl.appendChild(el);
    });
}

export async function handleAddPerson(form, listContainer) {
    const id = form.querySelector('#acc-id').value;
    const name = form.querySelector('#acc-name').value.trim();
    const role = form.querySelector('#acc-role').value;
    const contact = form.querySelector('#acc-contact').value.trim();

    if (!name) { showToast('Veuillez saisir un nom.'); return; }
    if (!role) { showToast('Veuillez choisir un rôle.'); return; }

    if (id) {
        // Mise à jour
        await updateAccessPerson(Number(id), { name, role, contact });
        try {
            await addHistoryEntry({
                type: 'access_update',
                details: { contactName: name, role: role }
            });
        } catch (e) { console.warn('History log error:', e); }
        showToast(`✅ ${name} mis(e) à jour.`);
    } else {
        // Ajout
        await addAccessPerson({ name, role, contact, addedAt: new Date().toISOString() });
        try {
            await addHistoryEntry({
                type: 'access_add',
                details: { contactName: name, role: role }
            });
        } catch (e) { console.warn('History log error:', e); }
        showToast(`✅ ${name} ajouté(e) avec succès.`);
    }

    cancelEdit(form);
    renderAccessList(listContainer);
}

export function editAccessPerson(person) {
    const form = document.getElementById('addPersonForm');
    form.querySelector('#acc-id').value = person.id;
    form.querySelector('#acc-name').value = person.name;
    form.querySelector('#acc-role').value = person.role;
    form.querySelector('#acc-contact').value = person.contact || '';

    form.querySelector('#submitBtnText').textContent = 'Enregistrer les modifications';
    document.getElementById('cancelEdit').style.display = 'block';
    
    // Défiler vers le formulaire
    form.closest('.card').scrollIntoView({ behavior: 'smooth' });
}

export function cancelEdit(form) {
    form.reset();
    form.querySelector('#acc-id').value = '';
    form.querySelector('#submitBtnText').textContent = 'Ajouter cette personne';
    document.getElementById('cancelEdit').style.display = 'none';
}

function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
