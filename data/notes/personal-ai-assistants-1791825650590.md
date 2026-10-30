# Research Notes: Personal AI assistants

# Personal AI Assistants: Privacy and Local Memory

Based on the provided research, the following study notes outline the current landscape of personal AI assistants with a focus on privacy and local memory capabilities.

## Key Trends and Priorities

*   **Privacy as a Differentiator:** As AI assistants develop deeper memory capabilities, the location and control of stored data are becoming critical factors for users. There is a growing demand for alternatives to cloud-dependent models.
*   **Local-First Architecture:** A significant trend is the move toward "local-first" designs. These systems prioritize running primarily on the user's own device (PC, phone, tablet) to ensure data ownership and persistence.
*   **Data Sovereignty and Control:** Users are seeking tools that offer "data sovereignty," meaning they have control over where their data lives—whether locally on their device or in a self-hosted environment—rather than handing personal history to third-party clouds.

## Notable Solutions and Features

### Memdex
*   **Function:** A semantic indexing tool designed to turn a user's local files (documents, PDFs, spreadsheets) into an offline memory bank.
*   **Privacy Model:** Prioritizes complete data sovereignty. It operates with 100% local storage, ensuring no data touches the cloud.
*   **Compatibility:** Works with localized open-source LLMs and offers offline functionality.

### Vellum (and similar platforms)
*   **Evaluation Criteria:** Privacy and data control are weighted heavily in assistant evaluations (scoring around 20% in some frameworks).
*   **Cross-Channel Memory:** Features are described that allow memory to follow the user across different tools (desktop, mobile, Slack), though the specific implementation of privacy controls varies.

### Perplexity AI Assistants
*   **User Control:** Users have explicit control over memory features, including the ability to disable them.
*   **Privacy Protections:** Memory and search history are automatically disabled in incognito mode. Data is encrypted, and users can opt out of contributing to model improvement via AI Data Retention settings.

### Open Source / Community Interest
*   There is active discussion in developer communities (e.g., OpenAI Developer Community) regarding the need for "Local-First Personal AI Assistants." Proposals focus on creating user-owned memory layers that persist across sessions while maintaining privacy-first principles.

## Summary of Privacy Mechanisms

*   **Local Storage:** Data stored on the user's device rather than remote servers.
*   **Encryption:** Data encryption is standard for protecting stored memories.
*   **User Controls:** Mechanisms to disable memory features (e.g., incognito mode) and opt-out of data contribution for model training.
*   **Semantic Indexing:** Tools like Memdex use semantic search to retrieve relevant context from local files without exposing raw data unnecessarily.

## Evidence Gaps and Uncertainties

*   **Implementation Specifics:** The research describes *desired* features and *claimed* capabilities (e.g., "100% local storage" for Memdex), but does not provide independent third-party audits or technical specifications verifying the exact data flows or architecture of these tools.
*   **Cross-Channel Privacy:** While "cross-channel consistency" is listed as a priority feature (e.g., memory following users from desktop to mobile), the research does not detail how privacy is maintained specifically during these transitions or if data syncing occurs in encrypted form.
*   **Long-term Data Retention:** The documents mention user controls to "opt out" of model improvement, but there is limited information on how historical memory data is purged or managed if a user chooses to disable these features after a period of use.
