# 🛡️ SIF Sentinel

### AI-Powered SIF Precursor Intelligence & HSE Decision Support

SIF Sentinel is a prototype safety-intelligence platform designed to analyze unstructured safety observations, near-miss reports and incident narratives to identify **Serious Injury and Fatality (SIF) precursor potential**, discover recurring safety patterns, and provide evidence-based HSE decision support.

The prototype combines **NLP-style text processing, domain safety rules, historical similarity matching, risk analytics, temporal pattern analysis and a dataset-driven knowledge graph** into a single interactive dashboard.

> ⚠️ **Prototype Data Notice**
>
> This repository uses a **controlled synthetic OIL-like development dataset** for demonstration and testing. It is **not OIL's confidential or operational data** and should not be interpreted as representing actual OIL risk distributions.

---

## 🎯 Problem Statement

Oil & Gas organizations generate large volumes of:

- Unsafe Act observations
- Unsafe Condition observations
- Near Miss reports
- Incident reports

These reports often contain important safety signals hidden inside free-text narratives.

Manual periodic review can make it difficult to quickly identify:

- SIF-potential situations
- Critical control/barrier failures
- Repeated precursor scenarios
- High-risk locations or departments
- Emerging patterns across time

### SIF Sentinel aims to provide a prioritization and intelligence layer that helps HSE teams move from:

**Raw Reports → SIF Detection → Precursor Intelligence → Risk Prioritization → Pattern Discovery → Evidence**

---

# 🚀 Key Features

## 1. 📊 Overview Dashboard

Provides a real-time view of the connected development dataset.

Displays:

- Total safety reports
- SIF classification distribution
- Severity distribution
- Incident types
- Precursor families
- Barrier failures
- Control status
- Departments
- Operating locations

---

## 2. 📝 Analyze Report

Users can submit a free-text safety narrative and receive a structured safety analysis.

### Analysis flow

```text
Free-text Safety Report
        ↓
Text Normalization
        ↓
Precursor / Safety Signal Detection
        ↓
Historical Similarity Matching
        ↓
Weighted Classification + Safety Rules
        ↓
SIF Assessment
        ↓
Risk Score
        ↓
Precursor / LSR / Barrier Intelligence
        ↓
Historical Evidence
