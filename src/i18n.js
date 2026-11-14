// -----------------------------------------------------------------------------
// Every text shown to the user, in English and French. `{name}` placeholders
// are filled by `t`. No text carries a key, an address, a subject or a body.
// -----------------------------------------------------------------------------

export const ALL_TEXTS = {
  // Status (Configuration screen).
  not_configured: {
    en: 'Enter the API key and the secret key of your Mailjet account, and a validated sender address.',
    fr: 'Saisissez la clé d’API et la clé secrète de votre compte Mailjet, et une adresse d’expéditeur validée.',
  },
  api_key_missing: {
    en: 'The API key is missing: a secret key alone is not used.',
    fr: 'La clé d’API manque : une clé secrète seule n’est pas utilisée.',
  },
  secret_missing: {
    en: 'The secret key is missing: an API key alone is not used.',
    fr: 'La clé secrète manque : une clé d’API seule n’est pas utilisée.',
  },
  api_key_invalid: {
    en: 'The API key is not valid (letters and digits, 32 characters on Mailjet).',
    fr: 'La clé d’API n’est pas valide (lettres et chiffres, 32 caractères chez Mailjet).',
  },
  secret_invalid: {
    en: 'The secret key is not valid (letters and digits, 32 characters on Mailjet).',
    fr: 'La clé secrète n’est pas valide (lettres et chiffres, 32 caractères chez Mailjet).',
  },
  sender_missing: {
    en: 'The sender address is missing.',
    fr: 'L’adresse de l’expéditeur manque.',
  },
  sender_invalid: {
    en: 'The sender address is not a valid e-mail address.',
    fr: 'L’adresse de l’expéditeur n’est pas une adresse e-mail valide.',
  },
  limit_invalid: {
    en: 'The hourly limit must be a whole number between 1 and 200 e-mails.',
    fr: 'Le plafond horaire doit être un nombre entier de 1 à 200 e-mails.',
  },
  config_unread: {
    en: 'The configuration could not be read from Gladys yet; trying again.',
    fr: 'La configuration n’a pas encore pu être lue depuis Gladys ; nouvel essai en cours.',
  },
  ready: {
    en: 'Ready. The keys are checked by Mailjet at the first e-mail or with the Test button.',
    fr: 'Prêt. Les clés sont vérifiées par Mailjet au premier e-mail ou avec le bouton Tester.',
  },
  not_persisted: {
    en: 'Ready, but the hourly counter is not saved (/data unread, read-only or slow): the limit is only guaranteed until the next restart.',
    fr: 'Prêt, mais le compteur horaire n’est pas enregistré (/data non lu, en lecture seule ou lent) : le plafond n’est garanti que jusqu’au prochain redémarrage.',
  },
  working: {
    en: 'Mailjet accepted the last e-mail ({count} sent in the last hour, limit {limit}).',
    fr: 'Mailjet a accepté le dernier e-mail ({count} envoyés dans la dernière heure, plafond {limit}).',
  },
  tested: {
    en: 'Mailjet accepted the keys and the test message (sandbox test, nothing delivered; the sender may only be checked at the first real e-mail).',
    fr: 'Mailjet a accepté les clés et le message de test (test en bac à sable, rien n’a été distribué ; l’expéditeur n’est peut-être vérifié qu’au premier vrai e-mail).',
  },
  forward_off: {
    en: 'Gladys messages are not sent by e-mail (option “Also send the Gladys messages” off in the Mailjet configuration). Nothing was sent.',
    fr: 'Les messages de Gladys ne sont pas envoyés par e-mail (option « Envoyer aussi les messages de Gladys » désactivée dans la configuration Mailjet). Rien n’a été envoyé.',
  },
  unauthorized: {
    en: 'Mailjet (or a proxy) answered HTTP 401 without a Mailjet error code: check the keys. Not taken as a refusal: the next e-mail tries again.',
    fr: 'Mailjet (ou un proxy) a répondu HTTP 401 sans code d’erreur Mailjet : vérifiez les clés. Pas pris pour un refus : le prochain e-mail réessaie.',
  },
  refused: {
    en: 'Mailjet refused these keys (wrong, deleted or suspended key). Nothing is sent with them until the keys change or the Test button succeeds.',
    fr: 'Mailjet a refusé ces clés (clé erronée, supprimée ou suspendue). Plus rien n’est envoyé avec elles tant que les clés ne changent pas ou que le bouton Tester ne réussit pas.',
  },
  sender: {
    en: 'Mailjet accepted the keys but not the sender address: validate it (or its domain) in Mailjet, Senders & Domains.',
    fr: 'Mailjet a accepté les clés mais pas l’adresse de l’expéditeur : validez-la (ou son domaine) dans Mailjet, Expéditeurs et domaines.',
  },
  denied: {
    en: 'Mailjet accepted the keys but denied the sending (HTTP 403{code}).',
    fr: 'Mailjet a accepté les clés mais refusé l’envoi (HTTP 403{code}).',
  },
  address_invalid: {
    en: 'Mailjet refused an address as invalid: nothing was sent.',
    fr: 'Mailjet a refusé une adresse comme invalide : rien n’a été envoyé.',
  },
  invalid: {
    en: 'Mailjet refused the e-mail ({detail}): nothing was sent.',
    fr: 'Mailjet a refusé l’e-mail ({detail}) : rien n’a été envoyé.',
  },
  paused: {
    en: 'Mailjet asked to slow down or failed: nothing is sent before {time} (UTC).',
    fr: 'Mailjet a demandé de ralentir ou a échoué : rien n’est envoyé avant {time} (UTC).',
  },
  unconfirmed: {
    en: 'The e-mail went to Mailjet without a readable confirmation: it may have been sent, so it is not sent again.',
    fr: 'L’e-mail est parti vers Mailjet sans confirmation lisible : il a pu être envoyé, il n’est donc pas renvoyé.',
  },
  pending: {
    en: 'The e-mail went to Mailjet, no answer yet: it is not sent again; the status will say how it went.',
    fr: 'L’e-mail est parti vers Mailjet, sans réponse pour l’instant : il n’est pas renvoyé ; le statut dira comment cela s’est passé.',
  },
  timeout: {
    en: 'Mailjet did not answer in time: the e-mail may have been sent, so it is not sent again.',
    fr: 'Mailjet n’a pas répondu à temps : l’e-mail a pu être envoyé, il n’est donc pas renvoyé.',
  },
  network: {
    en: 'Mailjet could not be reached, or the connection was cut (network): the e-mail may have been sent, so it is not sent again.',
    fr: 'Mailjet est injoignable, ou la connexion a été coupée (réseau) : l’e-mail a pu être envoyé, il n’est donc pas renvoyé.',
  },
  network_not_sent: {
    en: 'Mailjet could not be reached (network): nothing was sent.',
    fr: 'Mailjet est injoignable (réseau) : rien n’a été envoyé.',
  },
  unexpected: {
    en: 'Mailjet sent an unexpected answer (HTTP {status}): the e-mail is not sent again.',
    fr: 'Mailjet a envoyé une réponse inattendue (HTTP {status}) : l’e-mail n’est pas renvoyé.',
  },
  too_large: {
    en: 'Mailjet sent an answer too large to read: the e-mail is not sent again.',
    fr: 'Mailjet a envoyé une réponse trop grande pour être lue : l’e-mail n’est pas renvoyé.',
  },
  limit_reached: {
    en: 'The hourly limit of {limit} e-mails is reached: nothing more is sent before {time} (UTC) or a higher limit.',
    fr: 'Le plafond horaire de {limit} e-mails est atteint : plus rien n’est envoyé avant {time} (UTC) ou un plafond plus haut.',
  },
  busy: {
    en: 'Too many e-mails at once: this one was not sent.',
    fr: 'Trop d’e-mails à la fois : celui-ci n’a pas été envoyé.',
  },
  recipient_invalid: {
    en: 'The recipient is not a valid e-mail address: nothing was sent.',
    fr: 'Le destinataire n’est pas une adresse e-mail valide : rien n’a été envoyé.',
  },
  contact_invalid: {
    en: 'The e-mail address of this Gladys user (My account block) is not valid: nothing was sent.',
    fr: 'L’adresse e-mail de cet utilisateur de Gladys (bloc Mon compte) n’est pas valide : rien n’a été envoyé.',
  },
  empty_text: {
    en: 'Nothing to send: the text is empty.',
    fr: 'Rien à envoyer : le texte est vide.',
  },
  stopped: {
    en: 'The integration is stopping: nothing was sent.',
    fr: 'L’intégration s’arrête : rien n’a été envoyé.',
  },
  // The Test button.
  test_ok: {
    en: 'Mailjet accepted the keys and a test e-mail from {sender} in sandbox mode, in {ms} ms. Nothing was delivered. Whether Mailjet checks the sender in sandbox mode is not confirmed: the first real e-mail tells (try a scene with the “Send an e-mail with Mailjet” action).',
    fr: 'Mailjet a accepté les clés et un e-mail de test de {sender} en mode bac à sable, en {ms} ms. Rien n’a été distribué. Il n’est pas confirmé que Mailjet vérifie l’expéditeur en bac à sable : le premier vrai e-mail le dira (essayez une scène avec l’action « Envoyer un e-mail avec Mailjet »).',
  },
  test_subject: {
    en: 'Gladys: Mailjet test',
    fr: 'Gladys : test de Mailjet',
  },
  test_text: {
    en: 'Sandbox test of the Mailjet integration of Gladys (never delivered).',
    fr: 'Test en bac à sable de l’intégration Mailjet de Gladys (jamais distribué).',
  },
};

/** The text of `key` in `lang` ('fr' or English), placeholders filled. */
export function t(key, lang = 'en', vars = {}) {
  const entry = ALL_TEXTS[key] ?? ALL_TEXTS.unexpected;
  const text = lang === 'fr' ? entry.fr : entry.en;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

/** Both languages, for setConnectionStatus and the action results. */
export function both(key, vars = {}) {
  return { en: t(key, 'en', vars), fr: t(key, 'fr', vars) };
}

/** One error message for a scene or a Gladys message: English, then French. */
export function bilingual(key, vars = {}) {
  return `${t(key, 'en', vars)} / ${t(key, 'fr', vars)}`;
}
