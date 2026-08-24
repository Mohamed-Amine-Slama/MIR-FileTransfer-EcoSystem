import type { Locale } from '@mir/contracts';

/**
 * UI strings — DECISION D4 (Arabic and French from day one).
 *
 * WHY A TYPED DICTIONARY RATHER THAN INLINE STRINGS.
 * The first two screens hardcoded Arabic. That works until French is real, and
 * then every missing translation is discovered by a French-speaking user
 * rather than by the compiler. Here `Dictionary` is derived from the Arabic
 * table and `fr` is declared as the SAME type, so omitting a key is a build
 * error. A locale cannot ship half-translated.
 *
 * No interpolation engine: values that vary are passed as parameters to small
 * functions. A template mini-language would be one more thing to get wrong in
 * a direction-sensitive layout.
 */

const ar = {
  appName: 'MIR',
  appTagline: 'نقل الصور الطبية عبر الحدود — من ليبيا إلى تونس',

  // navigation
  navHome: 'الرئيسية',
  navPatients: 'المرضى',
  navUpload: 'رفع الصور',
  navAppointments: 'المواعيد',
  navInbox: 'الإحالات الواردة',
  navAvailability: 'أوقات التوفر',
  navAudit: 'سجل التدقيق',
  navSignIn: 'تسجيل الدخول',
  navSignOut: 'تسجيل الخروج',
  navLanguage: 'اللغة',

  // generic
  loading: 'جارٍ التحميل…',
  save: 'حفظ',
  cancel: 'إلغاء',
  back: 'رجوع',
  next: 'التالي',
  confirm: 'تأكيد',
  search: 'بحث',
  retry: 'إعادة المحاولة',
  none: 'لا يوجد',
  required: 'هذا الحقل مطلوب',
  genericError: 'تعذّر إتمام العملية. حاول مرة أخرى.',
  notAuthorised: 'لا تملك صلاحية الوصول إلى هذه الصفحة.',
  signInRequired: 'يجب تسجيل الدخول أولاً.',

  // sign in
  signInTitle: 'تسجيل الدخول',
  signInDescription: 'الدخول عبر مزوّد الهوية. الأطباء والإداريون يحتاجون إلى التحقق بخطوتين.',
  signInContinue: 'المتابعة إلى مزوّد الهوية',
  signInDevTitle: 'دخول التطوير',
  signInDevHint: 'ألصق رمز الوصول (JWT) للاختبار المحلي فقط.',
  signInToken: 'رمز الوصول',

  // claim
  claimTitle: 'ربط حسابك بسجلك الطبي',
  claimDescription: 'أدخل الرمز المكوّن من ستة أرقام الذي وصلك برسالة نصية.',
  claimCode: 'رمز التحقق',
  claimSubmit: 'ربط الحساب',
  claimSuccess: 'تم ربط حسابك بنجاح.',
  claimInvalid: 'الرمز غير صحيح أو منتهي الصلاحية.',

  // patients
  patientsTitle: 'المرضى',
  patientsDescription: 'البحث بالهاتف فقط — لا يمكن البحث بالاسم.',
  patientsSearchPhone: 'رقم الهاتف',
  patientsNew: 'مريض جديد',
  patientsEmpty: 'لا يوجد مرضى بعد.',
  patientsNoMatch: 'لا توجد نتائج لهذا الرقم.',
  patientName: 'الاسم الكامل',
  patientDob: 'تاريخ الميلاد',
  patientSex: 'الجنس',
  patientSexM: 'ذكر',
  patientSexF: 'أنثى',
  patientSexO: 'آخر',
  patientNationalId: 'رقم الهوية (اختياري)',
  patientCreate: 'إنشاء المريض',
  patientDuplicateTitle: 'يوجد مريض بنفس رقم الهاتف',
  patientDuplicateBody:
    'راجع القائمة أدناه. إن كان شخصًا مختلفًا، أكّد ذلك صراحةً — لن يتم الدمج تلقائيًا.',
  patientDuplicateConfirm: 'هذا شخص مختلف، تابع الإنشاء',
  patientIssueClaim: 'إرسال رمز الربط',
  patientClaimSent: 'تم إرسال الرمز برسالة نصية.',
  patientStudies: 'الدراسات',
  patientAppointments: 'المواعيد',

  // consent
  consentTitle: 'الموافقة على النقل عبر الحدود',
  consentDescription:
    'ستُنقل صورك الطبية إلى طبيب في تونس. اقرأ النص ثم وافق للمتابعة.',
  consentAgree: 'أوافق',
  consentRevoke: 'سحب الموافقة',
  consentGranted: 'تم تسجيل موافقتك.',
  consentRevoked: 'تم سحب الموافقة.',
  consentRequired: 'لا يمكن المتابعة دون موافقة.',

  // scheduling
  bookingTitle: 'حجز موعد',
  bookingStepDoctor: 'اختيار الطبيب',
  bookingStepSlot: 'اختيار الموعد',
  bookingStepStudies: 'اختيار الدراسات',
  bookingStepConfirm: 'التأكيد',
  bookingDoctor: 'الطبيب',
  bookingSlot: 'الموعد',
  bookingNoSlots: 'لا توجد مواعيد متاحة في هذه الفترة.',
  bookingConfirm: 'تأكيد الحجز',
  bookingSlotTaken: 'لم يعد هذا الموعد متاحًا. اختر موعدًا آخر.',
  appointmentsTitle: 'المواعيد',
  appointmentsEmpty: 'لا توجد مواعيد.',
  appointmentStatus: 'الحالة',
  statusPendingPayment: 'بانتظار الدفع',
  statusAuthorised: 'تم حجز المبلغ',
  statusConfirmed: 'مؤكد',
  statusCancelled: 'ملغى',
  statusExpired: 'منتهي',

  // availability
  availabilityTitle: 'أوقات التوفر',
  availabilityDescription: 'حدّد الفترات التي يمكن للمرضى الحجز خلالها.',
  availabilityFrom: 'من',
  availabilityTo: 'إلى',
  availabilitySlotMinutes: 'مدة الموعد (دقائق)',
  availabilityAdd: 'إضافة فترة',
  availabilityEmpty: 'لم تُحدَّد أي فترات بعد.',

  // billing
  checkoutTitle: 'الدفع',
  checkoutDescription:
    'يُحجز المبلغ الآن ولا يُخصم إلا بعد قبول الطبيب للإحالة.',
  checkoutAmount: 'المبلغ',
  checkoutPay: 'تفويض الدفع',
  checkoutAuthorised: 'تم حجز المبلغ بنجاح.',
  checkoutFailed: 'فشل تفويض الدفع.',

  // doctor inbox
  inboxTitle: 'الإحالات الواردة',
  inboxEmpty: 'لا توجد إحالات.',
  inboxAccept: 'قبول الإحالة',
  inboxDecline: 'رفض',
  inboxAccepted: 'تم قبول الإحالة وخصم المبلغ.',
  inboxViewStudies: 'عرض الدراسات',
  inboxLockedUntilPayment: 'الصور غير متاحة قبل إتمام الدفع.',

  // audit
  auditTitle: 'سجل التدقيق',
  auditDescription: 'سجل غير قابل للتعديل لكل وصول إلى بيانات المرضى.',
  auditEmpty: 'لا توجد أحداث.',
  auditActor: 'المستخدم',
  auditAction: 'الإجراء',
  auditWhen: 'الوقت',
  auditOutcome: 'النتيجة',

  // app shell
  skipToContent: 'تخطي إلى المحتوى',
  menuTitle: 'القائمة',
  menuOpen: 'فتح القائمة',
  menuClose: 'إغلاق القائمة',
  roleLibyaDoctor: 'طبيب مُحيل (ليبيا)',
  rolePatient: 'مريض',
  roleTunisiaDoctor: 'طبيب مستقبِل (تونس)',
  roleAdmin: 'مشرف',
  footerDisclaimer: 'خدمة نقل وحجز — ليست أداة تشخيص.',
  breadcrumbLabel: 'مسار التنقل',

  // table columns
  colPatient: 'المريض',
  colDate: 'التاريخ',
  colActions: 'إجراءات',
  colDescription: 'الوصف',
  colImages: 'عدد الصور',

  // dashboard
  dashboardOverview: 'نظرة عامة',
  dashboardQuickActions: 'إجراءات سريعة',
  dashboardRecent: 'أحدث المواعيد',
  dashboardUpcoming: 'الموعد القادم',
  dashboardNoUpcoming: 'لا يوجد موعد قادم بعد.',
  dashboardAwaitingDecision: 'بانتظار قرارك',
  dashboardViewAll: 'عرض الكل',
  statPatients: 'المرضى المسجّلون',
  statAppointmentsTotal: 'إجمالي المواعيد',

  // audit extras
  auditAllowed: 'مسموح',
  auditDenied: 'مرفوض',
  auditFilterAll: 'الكل',
  auditFilterActionPlaceholder: 'تصفية حسب الإجراء…',
  auditShowingRecent: 'يعرض أحدث الأحداث',

  // upload
  uploadTitle: 'رفع الصور الطبية',
  uploadHint: 'اختر مجلد الدراسة من القرص. يمكن إغلاق المتصفح — سيستأنف الرفع تلقائيًا.',
  uploadFolderLabel: 'مجلد الدراسة',
  uploadDropHint: 'اختر مجلدًا يحتوي ملفات DICOM',
  uploadResumeNotice: 'جارٍ استئناف ملفات من الجلسة السابقة',
  uploadFiles: 'الملفات',
  uploadStatusDone: 'تم',
  uploadStatusVerifying: 'جارٍ التحقق',
  uploadStatusRetrying: 'إعادة المحاولة',
  uploadStatusReselect: 'أعد اختيار المجلد',
  uploadStatusFailed: 'فشل',
  uploadStatusWaiting: 'في الانتظار',

  // booking extras
  bookingChoose: 'اختيار',

  // viewer
  viewerTitle: 'عرض الدراسة',
  viewerPrev: 'السابق',
  viewerNext: 'التالي',
  viewerFidelityFull: 'دقة كاملة',
  viewerFidelityLoading: 'جارٍ تحميل الدقة الكاملة…',
  viewerFidelityPreviewOnly: 'معاينة فقط',
  viewerFidelityPreview: 'معاينة',
  viewerWindowSoft: 'أنسجة رخوة',
  viewerWindowLung: 'رئة',
  viewerWindowBone: 'عظام',
  viewerWindowReset: 'إعادة تعيين',
  viewerLazyNote: 'تُحمَّل الصور عند الطلب فقط.',

  // consent management
  navConsents: 'الموافقات',
  consentActiveTitle: 'الموافقات السارية',
  consentNoneActive: 'لا توجد موافقات سارية.',
  consentGrantTitle: 'منح موافقة جديدة',
  consentSelectDoctor: 'اختر الطبيب المستقبِل',
  consentGrantedOn: 'تاريخ المنح',

  // viewer extras
  viewerStudyInfo: 'بيانات الدراسة',
  viewerModality: 'النوع',
  viewerDownload: 'تنزيل DICOM الأصلية',
  viewerDownloadFailed: 'تعذّر التنزيل. حاول مرة أخرى.',
} as const;

export type Dictionary = { readonly [K in keyof typeof ar]: string };

/**
 * French. Typed as `Dictionary`, so a missing or misspelled key fails the
 * build rather than falling back to Arabic at runtime for a French user.
 */
const fr: Dictionary = {
  appName: 'MIR',
  appTagline: "Transfert transfrontalier d'imagerie médicale — Libye vers Tunisie",

  navHome: 'Accueil',
  navPatients: 'Patients',
  navUpload: 'Téléverser',
  navAppointments: 'Rendez-vous',
  navInbox: 'Demandes reçues',
  navAvailability: 'Disponibilités',
  navAudit: "Journal d'audit",
  navSignIn: 'Se connecter',
  navSignOut: 'Se déconnecter',
  navLanguage: 'Langue',

  loading: 'Chargement…',
  save: 'Enregistrer',
  cancel: 'Annuler',
  back: 'Retour',
  next: 'Suivant',
  confirm: 'Confirmer',
  search: 'Rechercher',
  retry: 'Réessayer',
  none: 'Aucun',
  required: 'Ce champ est obligatoire',
  genericError: "L'opération a échoué. Veuillez réessayer.",
  notAuthorised: "Vous n'avez pas accès à cette page.",
  signInRequired: 'Veuillez vous connecter.',

  signInTitle: 'Connexion',
  signInDescription:
    "Connexion via le fournisseur d'identité. Les médecins et administrateurs doivent utiliser la double authentification.",
  signInContinue: "Continuer vers le fournisseur d'identité",
  signInDevTitle: 'Connexion de développement',
  signInDevHint: "Collez un jeton d'accès (JWT) — usage local uniquement.",
  signInToken: "Jeton d'accès",

  claimTitle: 'Associer votre compte à votre dossier',
  claimDescription: 'Saisissez le code à six chiffres reçu par SMS.',
  claimCode: 'Code de vérification',
  claimSubmit: 'Associer le compte',
  claimSuccess: 'Votre compte a été associé.',
  claimInvalid: 'Code invalide ou expiré.',

  patientsTitle: 'Patients',
  patientsDescription: 'Recherche par téléphone uniquement — jamais par nom.',
  patientsSearchPhone: 'Numéro de téléphone',
  patientsNew: 'Nouveau patient',
  patientsEmpty: 'Aucun patient pour le moment.',
  patientsNoMatch: 'Aucun résultat pour ce numéro.',
  patientName: 'Nom complet',
  patientDob: 'Date de naissance',
  patientSex: 'Sexe',
  patientSexM: 'Masculin',
  patientSexF: 'Féminin',
  patientSexO: 'Autre',
  patientNationalId: "Numéro d'identité (facultatif)",
  patientCreate: 'Créer le patient',
  patientDuplicateTitle: 'Un patient existe déjà avec ce numéro',
  patientDuplicateBody:
    "Vérifiez la liste ci-dessous. S'il s'agit d'une autre personne, confirmez-le explicitement — aucune fusion automatique n'aura lieu.",
  patientDuplicateConfirm: "C'est une autre personne, continuer",
  patientIssueClaim: "Envoyer le code d'association",
  patientClaimSent: 'Code envoyé par SMS.',
  patientStudies: 'Examens',
  patientAppointments: 'Rendez-vous',

  consentTitle: 'Consentement au transfert transfrontalier',
  consentDescription:
    'Vos images médicales seront transférées à un médecin en Tunisie. Lisez le texte puis donnez votre consentement.',
  consentAgree: "J'accepte",
  consentRevoke: 'Retirer le consentement',
  consentGranted: 'Votre consentement a été enregistré.',
  consentRevoked: 'Consentement retiré.',
  consentRequired: 'Impossible de continuer sans consentement.',

  bookingTitle: 'Prendre rendez-vous',
  bookingStepDoctor: 'Choix du médecin',
  bookingStepSlot: 'Choix du créneau',
  bookingStepStudies: 'Choix des examens',
  bookingStepConfirm: 'Confirmation',
  bookingDoctor: 'Médecin',
  bookingSlot: 'Créneau',
  bookingNoSlots: 'Aucun créneau disponible sur cette période.',
  bookingConfirm: 'Confirmer la réservation',
  bookingSlotTaken: "Ce créneau n'est plus disponible. Choisissez-en un autre.",
  appointmentsTitle: 'Rendez-vous',
  appointmentsEmpty: 'Aucun rendez-vous.',
  appointmentStatus: 'Statut',
  statusPendingPayment: 'En attente de paiement',
  statusAuthorised: 'Montant préautorisé',
  statusConfirmed: 'Confirmé',
  statusCancelled: 'Annulé',
  statusExpired: 'Expiré',

  availabilityTitle: 'Disponibilités',
  availabilityDescription: 'Définissez les périodes réservables par les patients.',
  availabilityFrom: 'De',
  availabilityTo: 'À',
  availabilitySlotMinutes: 'Durée du créneau (minutes)',
  availabilityAdd: 'Ajouter une période',
  availabilityEmpty: 'Aucune période définie.',

  checkoutTitle: 'Paiement',
  checkoutDescription:
    "Le montant est préautorisé maintenant et débité uniquement après l'acceptation du médecin.",
  checkoutAmount: 'Montant',
  checkoutPay: 'Autoriser le paiement',
  checkoutAuthorised: 'Montant préautorisé avec succès.',
  checkoutFailed: "Échec de l'autorisation de paiement.",

  inboxTitle: 'Demandes reçues',
  inboxEmpty: 'Aucune demande.',
  inboxAccept: 'Accepter la demande',
  inboxDecline: 'Refuser',
  inboxAccepted: 'Demande acceptée, paiement débité.',
  inboxViewStudies: 'Voir les examens',
  inboxLockedUntilPayment: 'Les images ne sont pas accessibles avant le paiement.',

  auditTitle: "Journal d'audit",
  auditDescription: 'Journal inaltérable de chaque accès aux données patient.',
  auditEmpty: 'Aucun évènement.',
  auditActor: 'Utilisateur',
  auditAction: 'Action',
  auditWhen: 'Date',
  auditOutcome: 'Résultat',

  skipToContent: 'Aller au contenu',
  menuTitle: 'Menu',
  menuOpen: 'Ouvrir le menu',
  menuClose: 'Fermer le menu',
  roleLibyaDoctor: 'Médecin référent (Libye)',
  rolePatient: 'Patient',
  roleTunisiaDoctor: 'Médecin destinataire (Tunisie)',
  roleAdmin: 'Administrateur',
  footerDisclaimer: 'Service de transfert et de réservation — pas un outil de diagnostic.',
  breadcrumbLabel: 'Fil d’Ariane',

  colPatient: 'Patient',
  colDate: 'Date',
  colActions: 'Actions',
  colDescription: 'Description',
  colImages: 'Images',

  dashboardOverview: 'Vue d’ensemble',
  dashboardQuickActions: 'Actions rapides',
  dashboardRecent: 'Rendez-vous récents',
  dashboardUpcoming: 'Prochain rendez-vous',
  dashboardNoUpcoming: 'Aucun rendez-vous à venir.',
  dashboardAwaitingDecision: 'En attente de votre décision',
  dashboardViewAll: 'Tout afficher',
  statPatients: 'Patients enregistrés',
  statAppointmentsTotal: 'Total des rendez-vous',

  auditAllowed: 'Autorisé',
  auditDenied: 'Refusé',
  auditFilterAll: 'Tous',
  auditFilterActionPlaceholder: 'Filtrer par action…',
  auditShowingRecent: 'Événements les plus récents affichés',

  uploadTitle: 'Téléverser les images médicales',
  uploadHint:
    'Sélectionnez le dossier de l’examen. Vous pouvez fermer le navigateur — le téléversement reprendra automatiquement.',
  uploadFolderLabel: 'Dossier de l’examen',
  uploadDropHint: 'Choisissez un dossier contenant des fichiers DICOM',
  uploadResumeNotice: 'Reprise de fichiers de la session précédente',
  uploadFiles: 'Fichiers',
  uploadStatusDone: 'Terminé',
  uploadStatusVerifying: 'Vérification…',
  uploadStatusRetrying: 'Nouvelle tentative',
  uploadStatusReselect: 'Resélectionnez le dossier',
  uploadStatusFailed: 'Échec',
  uploadStatusWaiting: 'En attente',

  bookingChoose: 'Choisir',

  viewerTitle: 'Visualisation de l’examen',
  viewerPrev: 'Précédent',
  viewerNext: 'Suivant',
  viewerFidelityFull: 'Pleine résolution',
  viewerFidelityLoading: 'Chargement de la pleine résolution…',
  viewerFidelityPreviewOnly: 'Aperçu uniquement',
  viewerFidelityPreview: 'Aperçu',
  viewerWindowSoft: 'Tissus mous',
  viewerWindowLung: 'Poumon',
  viewerWindowBone: 'Os',
  viewerWindowReset: 'Réinitialiser',
  viewerLazyNote: 'Les images ne sont chargées qu’à la demande.',

  navConsents: 'Consentements',
  consentActiveTitle: 'Consentements actifs',
  consentNoneActive: 'Aucun consentement actif.',
  consentGrantTitle: 'Accorder un nouveau consentement',
  consentSelectDoctor: 'Choisissez le médecin destinataire',
  consentGrantedOn: 'Accordé le',

  viewerStudyInfo: 'Informations de l’examen',
  viewerModality: 'Modalité',
  viewerDownload: 'Télécharger le DICOM original',
  viewerDownloadFailed: 'Échec du téléchargement. Réessayez.',
};

export const DICTIONARIES: Record<Locale, Dictionary> = { ar, fr };

export const LOCALE_NAMES: Record<Locale, string> = {
  ar: 'العربية',
  fr: 'Français',
};
