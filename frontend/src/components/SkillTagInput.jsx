import { useState, useRef, useEffect } from 'react';

const SKILLS = [
  // Languages
  'JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'C', 'C++', 'C#', 'Scala', 'R', 'Bash', 'Shell Scripting', 'PowerShell', 'Perl', 'MATLAB', 'Dart', 'Elixir', 'Haskell', 'Lua', 'Julia', 'COBOL', 'Fortran', 'Assembly', 'Groovy', 'F#', 'Clojure', 'Erlang', 'Zig',

  // Frontend Development
  'Frontend Development', 'React', 'Next.js', 'Vue.js', 'Nuxt.js', 'Angular', 'Svelte', 'SvelteKit', 'SolidJS', 'Qwik', 'Astro', 'HTML', 'CSS', 'Tailwind CSS', 'SASS', 'SCSS', 'Bootstrap', 'Material UI', 'Chakra UI', 'shadcn/ui', 'Ant Design', 'Redux', 'Zustand', 'Jotai', 'Recoil', 'MobX', 'React Query', 'SWR', 'Webpack', 'Vite', 'Rollup', 'Parcel', 'Babel', 'Web Performance', 'Accessibility (a11y)', 'Responsive Design', 'Progressive Web Apps', 'WebAssembly', 'Three.js', 'D3.js', 'Chart.js',

  // Backend Development
  'Backend Development', 'Node.js', 'Express.js', 'NestJS', 'Fastify', 'Hapi.js', 'Django', 'FastAPI', 'Flask', 'Spring Boot', 'Spring Framework', 'Hibernate', 'Laravel', 'Symfony', 'CodeIgniter', 'Ruby on Rails', 'Sinatra', 'Phoenix', 'Gin', 'Echo', 'Fiber', 'ASP.NET', 'ASP.NET Core', 'GraphQL', 'REST API', 'gRPC', 'WebSockets', 'Microservices', 'API Design', 'Server-Side Rendering', 'Message Queues', 'Event-Driven Architecture',

  // Full Stack
  'Full Stack Development', 'MERN Stack', 'MEAN Stack', 'LAMP Stack', 'JAMstack', 'T3 Stack',

  // Mobile Development
  'Mobile Development', 'React Native', 'Flutter', 'Android Development', 'iOS Development', 'Expo', 'Kotlin Multiplatform', 'SwiftUI', 'UIKit', 'Jetpack Compose', 'Xamarin', 'Ionic', 'Capacitor', 'Cordova',

  // Database
  'MongoDB', 'PostgreSQL', 'MySQL', 'SQLite', 'MariaDB', 'Oracle Database', 'MS SQL Server', 'Redis', 'Memcached', 'Elasticsearch', 'OpenSearch', 'DynamoDB', 'Cassandra', 'CockroachDB', 'PlanetScale', 'Supabase', 'Firebase', 'Firestore', 'Prisma', 'Mongoose', 'TypeORM', 'Sequelize', 'SQLAlchemy', 'SQL', 'NoSQL', 'Database Design', 'Database Administration', 'Query Optimization', 'ClickHouse', 'BigQuery', 'Snowflake', 'Redshift', 'Neo4j', 'InfluxDB', 'TimescaleDB',

  // Cloud & DevOps
  'AWS', 'GCP', 'Google Cloud', 'Azure', 'DigitalOcean', 'Heroku', 'Vercel', 'Netlify', 'Cloudflare', 'AWS Lambda', 'AWS EC2', 'AWS S3', 'AWS RDS', 'AWS EKS', 'AWS ECS', 'AWS IAM', 'Azure DevOps', 'Azure AKS', 'Google Kubernetes Engine', 'Docker', 'Kubernetes', 'Helm', 'Istio', 'Linkerd', 'Terraform', 'Pulumi', 'CloudFormation', 'Ansible', 'Chef', 'Puppet', 'SaltStack', 'CI/CD', 'GitHub Actions', 'GitLab CI', 'Jenkins', 'CircleCI', 'Travis CI', 'ArgoCD', 'Flux', 'Spinnaker', 'Linux', 'Ubuntu', 'CentOS', 'Nginx', 'Apache', 'HAProxy', 'Traefik', 'DevOps', 'Site Reliability Engineering', 'Infrastructure as Code', 'Prometheus', 'Grafana', 'Datadog', 'New Relic', 'Splunk', 'ELK Stack', 'Loki', 'Jaeger', 'OpenTelemetry', 'PagerDuty',

  // IAM & Identity
  'Okta', 'Okta Workforce Identity', 'Okta Customer Identity', 'Auth0', 'Azure Active Directory', 'Azure AD B2C', 'AWS IAM', 'AWS Cognito', 'Google Identity Platform', 'Ping Identity', 'PingFederate', 'PingOne', 'OneLogin', 'ForgeRock', 'SailPoint', 'SailPoint IdentityNow', 'SailPoint IIQ', 'CyberArk', 'BeyondTrust', 'HashiCorp Vault', 'Keycloak', 'LDAP', 'Active Directory', 'Microsoft Entra ID', 'Duo Security', 'RSA SecurID', 'IAM', 'Identity and Access Management', 'Privileged Access Management', 'PAM', 'Single Sign-On', 'SSO', 'Multi-Factor Authentication', 'MFA', 'OAuth', 'OAuth 2.0', 'OIDC', 'OpenID Connect', 'SAML', 'SAML 2.0', 'SCIM', 'Zero Trust', 'RBAC', 'ABAC', 'Identity Governance', 'IGA', 'Access Certification', 'Provisioning', 'Deprovisioning', 'Directory Services', 'LDAP', 'Kerberos', 'PKI', 'X.509', 'JWT', 'Federated Identity',

  // Ticketing & ITSM
  'Jira', 'Jira Service Management', 'Confluence', 'ServiceNow', 'ServiceNow ITSM', 'ServiceNow ITOM', 'ServiceNow GRC', 'Zendesk', 'Zendesk Support', 'Freshdesk', 'Freshservice', 'Salesforce Service Cloud', 'HubSpot', 'Intercom', 'Zoho Desk', 'Linear', 'GitHub Issues', 'GitLab Issues', 'Asana', 'Monday.com', 'Trello', 'Notion', 'ClickUp', 'Basecamp', 'Shortcut', 'PagerDuty', 'OpsGenie', 'BMC Remedy', 'BMC Helix', 'Cherwell', 'Ivanti', 'ManageEngine', 'Redmine', 'Bugzilla', 'ITIL', 'IT Service Management',

  // Messaging & Event Streaming
  'Apache Kafka', 'RabbitMQ', 'AWS SQS', 'AWS SNS', 'Google Pub/Sub', 'Azure Service Bus', 'NATS', 'Redis Pub/Sub', 'Apache Pulsar', 'ActiveMQ', 'Celery', 'Bull', 'BullMQ',

  // Networking
  'TCP/IP', 'DNS', 'HTTP/HTTPS', 'Load Balancing', 'VPN', 'Firewall', 'CDN', 'Cloudflare', 'Network Security', 'SDN', 'BGP', 'OSPF', 'Cisco', 'Palo Alto Networks', 'Fortinet', 'F5',

  // Cybersecurity
  'Cybersecurity', 'Penetration Testing', 'Ethical Hacking', 'Network Security', 'Application Security', 'AppSec', 'Cloud Security', 'DevSecOps', 'OWASP', 'Vulnerability Assessment', 'Vulnerability Management', 'Incident Response', 'Threat Intelligence', 'Threat Hunting', 'SIEM', 'Splunk SIEM', 'Microsoft Sentinel', 'IBM QRadar', 'SOC', 'SOC Analysis', 'Threat Modeling', 'Burp Suite', 'Metasploit', 'Nmap', 'Wireshark', 'Nessus', 'Qualys', 'Rapid7', 'CrowdStrike', 'SentinelOne', 'Carbon Black', 'Cryptography', 'Intrusion Detection', 'Intrusion Prevention', 'Risk Assessment', 'GRC', 'Compliance', 'GDPR', 'HIPAA', 'PCI DSS', 'ISO 27001', 'SOC 2', 'NIST', 'FedRAMP', 'CCPA', 'Forensics', 'Malware Analysis', 'Reverse Engineering', 'Red Team', 'Blue Team', 'Purple Team',

  // Data & Analytics
  'Data Science', 'Machine Learning', 'Deep Learning', 'Artificial Intelligence', 'Natural Language Processing', 'Computer Vision', 'Data Engineering', 'Data Analysis', 'Data Visualization', 'Business Intelligence', 'Statistical Analysis', 'A/B Testing', 'TensorFlow', 'PyTorch', 'Keras', 'Scikit-learn', 'XGBoost', 'LightGBM', 'Hugging Face', 'Pandas', 'NumPy', 'SciPy', 'Matplotlib', 'Seaborn', 'Plotly', 'Apache Spark', 'Apache Hadoop', 'Apache Flink', 'Apache Hive', 'Airflow', 'Prefect', 'Luigi', 'dbt', 'Fivetran', 'Stitch', 'Talend', 'Informatica', 'Tableau', 'Power BI', 'Looker', 'Metabase', 'Superset', 'QlikView', 'MicroStrategy', 'LLMs', 'OpenAI API', 'LangChain', 'LlamaIndex', 'RAG', 'Vector Databases', 'Pinecone', 'Weaviate', 'Chroma', 'MLflow', 'Kubeflow', 'SageMaker', 'Vertex AI', 'Feature Stores',

  // Observability & Monitoring
  'Prometheus', 'Grafana', 'Datadog', 'New Relic', 'Dynatrace', 'AppDynamics', 'Splunk', 'ELK Stack', 'Elasticsearch', 'Logstash', 'Kibana', 'OpenTelemetry', 'Jaeger', 'Zipkin', 'Loki', 'Tempo', 'Sentry', 'Rollbar', 'Bugsnag',

  // Design & Product
  'UI/UX Design', 'Product Design', 'Figma', 'Sketch', 'Adobe XD', 'InVision', 'Zeplin', 'Framer', 'Principle', 'Adobe Photoshop', 'Adobe Illustrator', 'Adobe After Effects', 'User Research', 'Usability Testing', 'Wireframing', 'Prototyping', 'Design Systems', 'Motion Design', 'Information Architecture', 'Interaction Design', 'Brand Design',

  // QA & Testing
  'QA Engineering', 'Test Automation', 'Selenium', 'Cypress', 'Playwright', 'WebdriverIO', 'Appium', 'Detox', 'Jest', 'Mocha', 'Chai', 'Vitest', 'PyTest', 'JUnit', 'TestNG', 'Postman', 'Newman', 'K6', 'Locust', 'JMeter', 'Gatling', 'Unit Testing', 'Integration Testing', 'End-to-End Testing', 'Load Testing', 'Performance Testing', 'Security Testing', 'Manual Testing', 'BDD', 'TDD', 'Cucumber', 'Robot Framework',

  // Collaboration & Version Control
  'Git', 'GitHub', 'GitLab', 'Bitbucket', 'SVN', 'Mercurial', 'Code Review', 'Pull Requests',

  // CRM & ERP
  'Salesforce', 'Salesforce CRM', 'Salesforce Apex', 'Salesforce Lightning', 'HubSpot CRM', 'SAP', 'SAP HANA', 'SAP S/4HANA', 'Oracle ERP', 'Microsoft Dynamics', 'Workday', 'NetSuite', 'Zoho CRM',

  // Communication & Productivity
  'Slack', 'Microsoft Teams', 'Zoom', 'Google Workspace', 'Microsoft 365', 'SharePoint', 'Okta', 'Notion', 'Confluence',

  // Blockchain & Web3
  'Blockchain', 'Web3', 'Solidity', 'Smart Contracts', 'Ethereum', 'Solana', 'Polygon', 'DeFi', 'NFT', 'IPFS', 'Hardhat', 'Foundry', 'Truffle', 'ethers.js', 'Web3.js',

  // Game Development
  'Unity', 'Unreal Engine', 'Godot', 'C# (Unity)', 'Game Design', 'OpenGL', 'Vulkan', 'DirectX', 'WebGL',

  // Embedded & Systems
  'Embedded Systems', 'RTOS', 'FreeRTOS', 'Arduino', 'Raspberry Pi', 'IoT', 'MQTT', 'Firmware Development', 'C (Embedded)', 'Verilog', 'VHDL', 'FPGA',

  // General Engineering
  'System Design', 'Distributed Systems', 'Data Structures', 'Algorithms', 'Object-Oriented Programming', 'Functional Programming', 'Design Patterns', 'Clean Architecture', 'Domain-Driven Design', 'Event Sourcing', 'CQRS', 'Agile', 'Scrum', 'Kanban', 'SAFe', 'Technical Writing', 'Open Source', 'Pair Programming', 'Mentoring',
];

const SkillTagInput = ({ label, tags, onChange }) => {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [focused, setFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const q = input.trim().toLowerCase();
    if (!q) { setSuggestions([]); return; }

    const matches = SKILLS.filter(
      s => s.toLowerCase().includes(q) && !tags.includes(s)
    ).slice(0, 7);
    setSuggestions(matches);
    setHighlighted(-1);
  }, [input, tags]);

  const add = (skill) => {
    const val = skill.trim();
    if (!val || tags.includes(val)) return;
    onChange([...tags, val]);
    setInput('');
    setSuggestions([]);
    inputRef.current?.focus();
  };

  const remove = (tag) => onChange(tags.filter(t => t !== tag));

  const handleKeyDown = (e) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, suggestions.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)); return; }
      if (e.key === 'Enter' && highlighted >= 0) { e.preventDefault(); add(suggestions[highlighted]); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); if (input.trim()) add(input); }
    if (e.key === 'Escape') setSuggestions([]);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!dropdownRef.current?.contains(e.target) && e.target !== inputRef.current) {
        setSuggestions([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-1.5">{label}</label>
      <p className="text-xs text-slate-600 mb-2">Type to search from suggestions, or press Enter to add a custom skill</p>

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="w-full bg-[#1a1a28] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition"
          placeholder="e.g. Node.js, React, Python..."
          autoComplete="off"
        />

        {suggestions.length > 0 && (
          <ul
            ref={dropdownRef}
            className="absolute z-20 left-0 right-0 top-full mt-1 bg-[#1e1e2d] border border-white/10 rounded-lg shadow-2xl overflow-hidden"
          >
            {suggestions.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); add(s); }}
                  className={`w-full text-left px-3.5 py-2.5 text-sm transition-colors ${
                    i === highlighted
                      ? 'bg-violet-600/20 text-violet-300'
                      : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {s}
                </button>
              </li>
            ))}
            {input.trim() && !SKILLS.some(s => s.toLowerCase() === input.trim().toLowerCase()) && (
              <li>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); add(input.trim()); }}
                  className="w-full text-left px-3.5 py-2.5 text-sm text-slate-500 hover:bg-white/5 border-t border-white/10 transition-colors"
                >
                  Add "<span className="text-slate-300 font-medium">{input.trim()}</span>"
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 bg-violet-600/15 text-violet-300 border border-violet-500/20 text-xs font-medium px-2.5 py-1 rounded-full"
            >
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                className="hover:text-white leading-none ml-0.5"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default SkillTagInput;
