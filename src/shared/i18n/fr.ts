/**
 * French translations.
 *
 * This file is the reference: other locales reuse its keys, and the
 * `Dictionary` type is derived from it, so a key forgotten elsewhere becomes
 * a compile error.
 */
export const fr = {
  'app.tab.control': 'Contrôle',
  'app.tab.scenes': 'Scènes',
  'app.tab.sync': 'Écran',
  'app.tab.audio': 'Audio',
  'app.window.minimise': 'Réduire',
  'app.window.close': 'Fermer',
  'app.language': 'Langue',

  'bridge.missing.title': 'Éclat — pont IPC absent',
  'bridge.missing.body':
    "Cette page est servie par Vite, qui ne fournit que l'interface. Le dialogue avec les panneaux passe par le processus main d'Electron : le token d'authentification ne doit jamais atteindre le navigateur.",

  'control.noDevice.title': 'Aucun device connu',
  'control.noDevice.body': "Les panneaux s'annoncent en mDNS sur le réseau local.",
  'control.discover': 'Découvrir',
  'control.rescan': 'Rechercher d’autres panneaux',
  'control.newDevice':
    'Un autre mur a été trouvé sur le réseau. Choisis-le ci-dessus pour l’appairer.',
  'control.found.title': '{name} trouvé',
  'control.found.body':
    "Maintiens le bouton power du panneau 5 à 7 secondes, jusqu'à ce que la LED clignote, puis lance l'appairage.",
  'control.pair': 'Appairer',
  'control.panels': '{count} panneaux',
  'control.firmware': 'firmware {version}',
  'control.turnOn': 'Allumer',
  'control.turnOff': 'Éteindre',
  'control.brightness': 'Luminosité',
  'control.colour': 'Couleur',
  'control.externalControl': 'Piloté de l’extérieur',
  'control.colour.underScene':
    "Une scène est en cours : le device ne rapporte plus de teinte. Choisir une couleur la remplacera.",
  'control.orientation': 'Orientation du mur',
  'control.orientation.help':
    "Le device ne dit pas comment le mur est accroché, et rien n'oblige un mur à être posé d'équerre.",
  'control.motion.approximate':
    "Le mur est animé d'après les couleurs de la scène. Le device ne publie pas l'état de ses LED : c'est une approximation, pas un reflet.",
  'control.paint.help':
    "Clique un panneau pour l'allumer, clique-le encore pour l'éteindre. La roue recolore les panneaux allumés, ou tout le mur s'il n'y en a aucun.",
  'control.wallUnavailable': 'Rendu du mur indisponible',

  'scenes.empty': 'Aucune scène lue pour le moment.',
  'scenes.unpaired': 'Appaire un device pour voir ses scènes.',

  'sync.title': 'Synchronisation écran',
  'sync.running': 'En cours',
  'sync.stopped': 'À l’arrêt',
  'sync.choose': 'Choisir une source',
  'sync.choosing': 'Sélection…',
  'sync.stop': 'Arrêter',
  'sync.unpaired': "Appaire un device pour synchroniser l'écran.",
  'sync.preview.empty': "L'aperçu apparaîtra ici une fois la capture démarrée.",
  'sync.mode': 'Mode de mapping',
  'sync.mode.spatial': 'Spatial',
  'sync.mode.dominant': 'Dominante',
  'sync.mode.palette': 'Palette',
  'sync.radius': 'Rayon',
  'sync.saturation': 'Saturation',
  'sync.blackFloor': 'Plancher de noir',
  'sync.attack': 'Attaque',
  'sync.release': 'Relâche',
  'sync.hz': 'Cadence',
  'sync.source.screen': 'Écran',
  'sync.source.audio': 'Audio',
  'audio.title': 'Synchronisation audio',
  'audio.output': 'Sortie à écouter',
  'audio.refresh': 'Relire les sorties',
  'audio.none': 'Aucune sortie audio trouvée. PipeWire est-il en marche ?',
  'audio.start': 'Démarrer',
  'audio.stop': 'Arrêter',
  'audio.sensitivity': 'Sensibilité',
  'audio.beatFlash': 'Éclat au battement',
  'audio.gate': 'Seuil de silence',
  'audio.bass': 'Graves',
  'audio.mid': 'Médiums',
  'audio.treble': 'Aigus',
  'audio.beat': 'Battement',
  'audio.help':
    'Éclat écoute ce qui sort de tes enceintes, par le monitor PipeWire. Si le mur reste noir alors que la musique joue, vérifie que la sortie n’est pas coupée : PipeWire applique le volume avant la prise du monitor, et une sortie muette ne donne que du silence.',
  'sync.wayland.help':
    "Sous Wayland, c'est le sélecteur de GNOME qui choisit la fenêtre : l'application ne peut pas en afficher les vignettes. La source doit être re-choisie à chaque lancement, le portail ne rendant pas son jeton de restauration. En revanche le flux reste ouvert tant que l'app tourne, donc arrêter puis relancer le sync ne redemande rien.",

  'error.deviceUnknown': 'Device inconnu.',
  'error.deviceUnpaired': "Device non appairé : lance l'appairage.",
  'error.unreachable': 'Device injoignable sur le réseau.',
  'error.pairingCancelled': 'Appairage annulé.',
  'error.pairingRefused':
    "Le device a refusé l'appairage. Maintiens le bouton power 5 à 7 secondes, puis réessaie.",
  'error.processorMissing':
    "Cette version de Chromium ne sait pas lire la capture image par image : la synchronisation écran est indisponible.",
} as const

export type Dictionary = Record<keyof typeof fr, string>
