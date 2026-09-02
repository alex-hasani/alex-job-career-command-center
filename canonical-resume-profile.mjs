// Fictional demonstration data for the public repository.
//
// The private application loads verified candidate evidence. This public build
// deliberately ships no real contact details, employment history, metrics, or
// application outcomes. Replace this object locally with your own verified data
// and never commit that private file.
export const canonicalResumeProfile = {
  identity: {
    name: 'Jordan Example',
    location: 'Stuttgart Region, Germany',
    phone: '+49 000 0000000',
    email: 'candidate@example.com',
    linkedin: 'linkedin.com/in/example-candidate',
    github: 'github.com/example-candidate',
    workAuthorisation: {
      de: 'Arbeitserlaubnis: im lokalen Profil verifizieren',
      en: 'Work authorisation: verify in the local profile'
    }
  },
  baseHeadline: {
    de: 'Infrastructure Engineer | Hybrid Cloud & Automation',
    en: 'Infrastructure Engineer | Hybrid Cloud & Automation'
  },
  skills: [
    { id:'microsoft', label:{de:'Microsoft-Infrastruktur',en:'Microsoft Infrastructure'}, items:['Windows Server','Active Directory (AD DS)','GPO','DNS','DHCP','Microsoft 365','Entra ID','AD Connect'], evidence:['ev.current.infrastructure','ev.cloud.hybrid','ev.support.m365'] },
    { id:'linux', label:{de:'Linux / Unix',en:'Linux / Unix'}, items:['RHEL','Ubuntu','SUSE','Package, service, permission, storage and lifecycle administration'], evidence:['ev.current.infrastructure','ev.global.operations'] },
    { id:'virtualization', label:{de:'Virtualisierung & Rechenzentrum',en:'Virtualisation & Datacentre'}, items:['VMware vSphere','vCenter','ESXi','Clusters','vMotion','Templates','Snapshots','Host maintenance','VM provisioning','Datacentre migrations'], evidence:['ev.global.operations','ev.current.infrastructure'] },
    { id:'azure', label:{de:'Azure & Hybrid Cloud',en:'Azure & Hybrid Cloud'}, items:['Azure IaaS','Azure VMs','VNets','VNet Peering','VPN Gateway','Azure Bastion','NSGs','Azure Backup','Hybrid Identity','Entra ID / Azure AD','AD Connect'], evidence:['ev.cloud.hybrid','ev.support.m365'] },
    { id:'automation', label:{de:'Automatisierung',en:'Automation'}, items:['Ansible','Bash','PowerShell (praktische Kenntnisse / practical knowledge)','Python (praktische Kenntnisse / practical knowledge)','SSH','Git / GitHub'], evidence:['ev.current.infrastructure','ev.global.operations'] },
    { id:'operations', label:{de:'Betrieb & ITSM',en:'Operations & ITSM'}, items:['Incident Management','Problem Management','Change Management','Patching','Monitoring','Backup / Recovery','Server lifecycle','Troubleshooting','Hardening'], evidence:['ev.current.infrastructure','ev.global.operations','ev.reference.current'] },
    { id:'networking', label:{de:'Netzwerk & Storage',en:'Networking & Storage'}, items:['TCP/IP','VLAN','Routing','VPN','Firewall rules','NFS','SMB'], evidence:['ev.cloud.hybrid','ev.global.operations'] }
  ],
  roles: [
    {
      id:'current-infrastructure', employer:'Example Technology Services', location:'Stuttgart Region', officialTitle:{de:'Senior System Administrator',en:'Senior System Administrator'}, dates:{de:'2024–heute',en:'2024–present'}, evidence:['ev.current.infrastructure','ev.reference.current'],
      bullets:[
        { tags:['windows','linux','server','operations'], de:'Betreibt eine gemischte Windows- und Linux-Infrastruktur mit Provisionierung, Patching, Troubleshooting, Lifecycle und Recovery.', en:'Operates mixed Windows and Linux infrastructure covering provisioning, patching, troubleshooting, lifecycle and recovery.' },
        { tags:['server','hardware','scale'], de:'Verbessert Zuverlässigkeit und Nutzbarkeit des Server-Pools durch Prüfung, Reparatur, Upgrades und strukturierte Bereitstellung.', en:'Improves server-pool reliability and usability through testing, repair, upgrades and structured deployment.' },
        { tags:['ansible','automation','linux'], de:'Pflegt Ansible-Playbooks mit Rollen, Variablen, Validierung, Fehlerbehandlung und idempotenten Abläufen.', en:'Maintains Ansible playbooks with roles, variables, validation, error handling and idempotent workflows.' },
        { tags:['backup','recovery','pxe'], de:'Unterstützt standardisierte Backup- und Recovery-Prozesse und dokumentiert wiederholbare Wiederherstellungsabläufe.', en:'Supports standardised backup and recovery processes and documents repeatable restoration workflows.' },
        { tags:['datacenter','incident','availability'], de:'Koordiniert kontrollierte Infrastrukturmaßnahmen bei kritischen Rechenzentrumsereignissen und prüft die Wiederherstellung.', en:'Coordinates controlled infrastructure actions during critical datacentre events and validates restoration.' }
      ]
    },
    {
      id:'global-operations', employer:'Example Global Marketplace', location:'Germany', officialTitle:{de:'System Administrator',en:'System Administrator'}, dates:{de:'2022–2023',en:'2022–2023'}, evidence:['ev.global.operations'],
      bullets:[
        { tags:['windows','linux','operations','scale'], de:'Arbeitete in globalen Windows- und Linux-Betriebsteams mit Provisionierung, Patching, Incidents, Konfiguration, Performance und Lifecycle.', en:'Worked in global Windows and Linux operations teams covering provisioning, patching, incidents, configuration, performance and lifecycle.' },
        { tags:['vmware','virtualization'], de:'Betrieb von VMware vSphere, vCenter und ESXi mit Clustern, Snapshots, Templates, vMotion und Host-Wartung.', en:'Operated VMware vSphere, vCenter and ESXi with clusters, snapshots, templates, vMotion and host maintenance.' },
        { tags:['linux','ansible','bash','python','automation'], de:'Nutzte Bash, Python, Ansible und SSH für Linux-Administration, Remote-Konfiguration und Audit-Aufgaben.', en:'Used Bash, Python, Ansible and SSH for Linux administration, remote configuration and audit tasks.' },
        { tags:['windows','patching'], de:'Steuerte Windows-Patching über Test- und Produktionsumgebungen mit Wartungsfenstern, Freigaben und Remediation.', en:'Managed Windows patching across test and production environments with maintenance windows, approvals and remediation.' },
        { tags:['datacenter','migration','project'], de:'Unterstützte eine Rechenzentrumsverlagerung mit Discovery, Abhängigkeiten, Planung, Validierung und Dokumentation.', en:'Supported a datacentre relocation covering discovery, dependencies, planning, validation and documentation.' }
      ]
    },
    {
      id:'regional-operations', employer:'Example Infrastructure Partner', location:'Europe / APAC', officialTitle:{de:'System Administrator',en:'System Administrator'}, dates:{de:'2020–2022',en:'2020–2022'}, evidence:['ev.global.operations'],
      bullets:[
        { tags:['windows','linux','global'], de:'Unterstützte Windows- und Linux-Betrieb über mehrere Regionen mit Ticket-, Change- und Freigabeprozessen.', en:'Supported Windows and Linux operations across multiple regions using ticket, change and approval processes.' },
        { tags:['vmware','hardware'], de:'Arbeitete mit VMware sowie physischer Server- und Remote-Management-Infrastruktur.', en:'Worked with VMware plus physical server and remote-management infrastructure.' },
        { tags:['datacenter','migration'], de:'Unterstützte regionale Rechenzentrumsmigrationen und kontrollierte Infrastrukturwechsel.', en:'Supported regional datacentre migrations and controlled infrastructure transitions.' }
      ]
    },
    {
      id:'cloud-lead', employer:'Example Digital Learning Company', location:'Hybrid', officialTitle:{de:'IT Manager',en:'IT Manager'}, dates:{de:'2018–2020',en:'2018–2020'}, evidence:['ev.cloud.hybrid','ev.support.m365'],
      bullets:[
        { tags:['azure','hybrid','architecture','lead'], de:'Baute eine hybride VMware-/Azure-Umgebung für mehrere Standorte mit lokalen und Cloud-basierten Diensten auf.', en:'Built a hybrid VMware and Azure environment spanning multiple sites with on-premises and cloud services.' },
        { tags:['azure','networking','vpn','firewall'], de:'Implementierte VNets, Peering, VPN, Bastion, NSGs und segmentierte Produktions- und Entwicklungsnetze.', en:'Implemented VNets, peering, VPN, Bastion, NSGs and segmented production and development networks.' },
        { tags:['identity','entra','m365'], de:'Implementierte hybride Identität mit Active Directory, Entra ID, AD Connect und Microsoft 365.', en:'Implemented hybrid identity with Active Directory, Entra ID, AD Connect and Microsoft 365.' },
        { tags:['vmware','backup','recovery'], de:'Betrieb von VMware, virtuellen Netzwerken, Backup, Restore-Tests und Disaster Recovery.', en:'Operated VMware, virtual networking, backup, restore testing and disaster recovery.' },
        { tags:['lead','users','training'], de:'Koordinierte Infrastruktur, Identität, Endgeräte und Sicherheit und unterstützte Anwenderschulungen.', en:'Coordinated infrastructure, identity, endpoints and security and supported user training.' }
      ]
    },
    {
      id:'platform-operations', employer:'Example Managed Services', location:'International', officialTitle:{de:'System Administrator',en:'System Administrator'}, dates:{de:'2016–2018',en:'2016–2018'}, evidence:['ev.global.operations'],
      bullets:[
        { tags:['windows','linux','vmware'], de:'Windows-, Linux- und VMware-Betrieb mit Patching, Troubleshooting und globalen Change-Prozessen.', en:'Windows, Linux and VMware operations covering patching, troubleshooting and global change processes.' },
        { tags:['datacenter','migration'], de:'Unterstützte Rechenzentrumsmigrationen sowie kontrollierte Abschalt-, Start- und Validierungsabläufe.', en:'Supported datacentre migrations and controlled shutdown, start-up and validation activities.' }
      ]
    },
    {
      id:'m365-support', employer:'Example Cloud Support', location:'International', officialTitle:{de:'Microsoft 365 Support Engineer',en:'Microsoft 365 Support Engineer'}, dates:{de:'2015–2016',en:'2015–2016'}, evidence:['ev.support.m365'],
      bullets:[
        { tags:['m365','exchange','intune','identity'], de:'Unterstützte Onboarding, Readiness, Troubleshooting und Migration für Microsoft-365-Dienste.', en:'Supported onboarding, readiness, troubleshooting and migration for Microsoft 365 services.' },
        { tags:['m365','identity'], de:'Bearbeitete Identitätssynchronisierung, Mailflow, Lizenzierung, Authentifizierung und Geräteeinbindung.', en:'Worked on identity synchronisation, mail flow, licensing, authentication and device enrolment.' }
      ]
    }
  ],
  earlierExperience: {
    de:'Frühere Erfahrung: System Engineering, interner IT-Support und ICT-Audit in Beispielorganisationen.',
    en:'Earlier experience: systems engineering, internal IT support and ICT audit in example organisations.'
  },
  education: [
    { de:'B.Sc. Computer Engineering – Beispieluniversität, Deutschland', en:'BSc Computer Engineering – Example University, Germany' },
    { de:'Associate Degree Data Communication – Beispielhochschule', en:'Associate Degree in Data Communication – Example College' }
  ],
  development: {
    de:['Cloud-Administration: aktuelle Weiterbildung','Trainings: Azure, Windows Server, Ansible, PowerShell und Microsoft 365'],
    en:['Cloud administration: current professional development','Training: Azure, Windows Server, Ansible, PowerShell and Microsoft 365']
  },
  languages: {
    de:['Deutsch: B2 | Englisch: Full Professional Proficiency | Weitere Sprache: Muttersprache','Führerschein: Klasse B'],
    en:['German: B2 | English: Full Professional Proficiency | Additional language: Native','Driving licence: Category B']
  },
  boundaries: [
    { terms:['terraform','kubernetes','prometheus','grafana','zabbix','splunk'], reason:{de:'nicht als verifizierte Produktionserfahrung im Demo-Profil hinterlegt',en:'not stored as verified production experience in the demo profile'} },
    { terms:['c1','c2','native german','fluent german'], reason:{de:'Sprachniveau nur aus dem verifizierten lokalen Profil übernehmen',en:'language level must come from the verified local profile'} }
  ]
};
