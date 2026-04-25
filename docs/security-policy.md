# Security Vulnerability Disclosure Policy

## Reporting Security Issues

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly through our HackerOne program.

### Supported Systems

- **HackerOne Program**: [https://hackerone.com/agenticpay](https://hackerone.com/agenticpay)
- **Scope**: API endpoints, smart contracts, web applications, mobile apps
- **Response Time**: We aim to acknowledge reports within 24 hours

### Disclosure Guidelines

1. **DO NOT** publicly disclose vulnerabilities until we have had a chance to remediate
2. **DO NOT** exploit vulnerabilities beyond what is necessary to demonstrate the issue
3. **DO NOT** access, modify, or exfiltrate data beyond the minimum needed to prove the vulnerability
4. **DO NOT** perform attacks that could degrade our services for legitimate users

### In-Scope Vulnerabilities

We welcome reports on the following types of vulnerabilities:

- **Authentication & Authorization Bypass**
- **Cross-Site Scripting (XSS)**
- **Cross-Site Request Forgery (CSRF)**
- **SQL/NoSQL Injection**
- **Remote Code Execution**
- **Privilege Escalation**
- **Data Exposure**
- **Cryptographic Weaknesses**
- **Smart Contract Vulnerabilities** (reentrancy, overflow, access control)
- **API Security Issues**
- **Business Logic Flaws**

### Out-of-Scope Vulnerabilities

The following are generally out of scope:

- Social engineering attacks
- Physical security breaches
- DoS/DDoS attacks
- Issues requiring unrealistic user interaction
- Previously reported vulnerabilities
- Effects of third-party dependencies

### Safe Harbor

We承诺:

- 不会对负责任地报告安全问题的安全研究人员采取法律行动
- 在修复漏洞后公开致谢（除非研究人员要求匿名）
- 根据漏洞严重程度提供赏金奖励

### Bounty Tiers

| Severity | Bounty Range | Examples |
|----------|------------|----------|
| Critical | $5,000 - $50,000 | RCE, full auth bypass, massive data theft |
| High | $1,000 - $5,000 | SQL injection, XSS with session theft |
| Medium | $250 - $1,000 | Stored XSS, CSRF with impact |
| Low | $50 - $250 | Information disclosure, minor bypasses |

### Payment Process

- Bounties are paid via HackerOne
- Payment methods: Bugcrowd bounty, bank transfer, or crypto
- Paid within 30 days of report closure
- Annual program review in Q1 each year

### Contact

For urgent security issues: security@agenticpay.com

---

*Last Updated: 2026-04-23*