/**
 * access.js — Gestion des droits d'accès à la capsule
 */

import { getAccessList, addAccessPerson, removeAccessPerson, updateAccessPerson, showToast, addHistoryEntry, getUserProfile } from './app.js';

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
        let contactHtml = '';
        if (person.email) contactHtml += `<div class="contact">✉️ ${escHtml(person.email)}</div>`;
        if (person.phone) contactHtml += `<div class="contact">📞 ${escHtml(person.phone)}</div>`;
        // Compatibilité avec l'ancien champ 'contact'
        if (person.contact && !person.email && !person.phone) {
            contactHtml += `<div class="contact">${escHtml(person.contact)}</div>`;
        }

        el.innerHTML = `
      <div class="avatar">${initials}</div>
      <div class="access-info">
        <div class="name">${escHtml(person.name)}</div>
        ${contactHtml}
        <span class="access-badge ${role.badge} mt-8">${role.label}</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <button class="btn btn-secondary btn-sm notify-btn" title="Prévenir" style="background:var(--blue-pale); color:var(--blue-dark);">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
            <path d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.11ZM6.636 10.07l2.761 4.338L14.13 2.576 6.636 10.07Zm6.787-8.201L1.591 6.602l4.339 2.76 7.494-7.493Z"/>
          </svg>
        </button>
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

        el.querySelector('.notify-btn').addEventListener('click', () => {
            handleNotify(person);
        });

        containerEl.appendChild(el);
    });
}

export async function handleAddPerson(form, listContainer) {
    const id = form.querySelector('#acc-id').value;
    const name = form.querySelector('#acc-name').value.trim();
    const role = form.querySelector('#acc-role').value;
    const email = form.querySelector('#acc-email').value.trim();
    const phone = form.querySelector('#acc-phone').value.trim();

    if (!name) { showToast('Veuillez saisir un nom.'); return; }
    if (!role) { showToast('Veuillez choisir un rôle.'); return; }

    if (id) {
        // Mise à jour
        await updateAccessPerson(Number(id), { name, role, email, phone });
        try {
            await addHistoryEntry({
                type: 'access_update',
                details: { contactName: name, role: role }
            });
        } catch (e) { console.warn('History log error:', e); }
        showToast(`✅ ${name} mis(e) à jour.`);
    } else {
        // Ajout
        await addAccessPerson({ name, role, email, phone, addedAt: new Date().toISOString() });
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
    form.querySelector('#acc-email').value = person.email || '';
    form.querySelector('#acc-phone').value = person.phone || '';
    // Si la personne a un vieux champ contact mais pas les nouveaux, on peut éventuellement le copier quelque part ou l'ignorer en édition.
    if (person.contact && !person.email && !person.phone) {
        // On le met par défaut dans le mail si ça ressemble à un mail, sinon téléphone ?
        // Mais restons simples: si c'est un vieil objet, l'utilisateur devra reremplir proprement ou on laisse vide.
    }

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

export async function handleNotify(person) {
    const profile = await getUserProfile();
    const senderName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : 'Un contact';
    const message = `${senderName} vient de vous donner accès à sa Capsule Vidéo pour le Rétablissement.

Merci de la visionner avec bienveillance, dans le respect de la confidentialité et de l’usage thérapeutique de ce support.

Cette capsule a été réalisée en période de stabilité afin de transmettre des repères, des souhaits et des ressources en cas de difficulté ou de situation de crise.

En cas d’urgence ou de situation préoccupante, vous êtes autorisé(e) à la montrer au personnel soignant, ainsi qu’à ${senderName} s'il/elle n’y a plus accès, afin de faciliter la compréhension de ses besoins et l’accompagnement.

Voici le lien de la capsule vidéo : {futur lien de partage pour le jour où les capsules seront également stockées sur un serveur}`;

    const canEmail = !!person.email;
    const canSms = !!person.phone;

    try {
        if (navigator.share) {
            await navigator.share({
                title: 'Capsule Vidéo pour le Rétablissement',
                text: message
            });
            showToast('Message prêt à être envoyé.');
            return;
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.warn('Share API error:', e);
        } else {
            return; // Annulé par l'utilisateur
        }
    }

    if (canSms) {
        window.location.href = `sms:${person.phone}?body=${encodeURIComponent(message)}`;
    } else if (canEmail) {
        window.location.href = `mailto:${person.email}?subject=Capsule%20Vid\u00E9o%20-%20Acc\u00E8s%20autoris\u00E9&body=${encodeURIComponent(message)}`;
    } else if (person.contact) {
        if (person.contact.includes('@')) {
            window.location.href = `mailto:${person.contact}?subject=Capsule%20Vid\u00E9o%20-%20Acc\u00E8s%20autoris\u00E9&body=${encodeURIComponent(message)}`;
        } else {
            window.location.href = `sms:${person.contact}?body=${encodeURIComponent(message)}`;
        }
    } else {
        showToast("Aucun contact renseigné pour cette personne.");
    }
}
