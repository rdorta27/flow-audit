# Glossary — BSS order flow

Terms as this project uses them. One meaning per term.

| Term | Meaning here |
|---|---|
| **BSS** | Business Support Systems: the systems that run the commercial side of a telecom operator — catalog, ordering, billing, care. |
| **OSS** | Operations Support Systems: network inventory, provisioning and assurance. Out of scope except as the provisioning boundary. |
| **Order** | The commercial order a customer placed. Identified `ORD-…`. Enters the audit only as the root reference. |
| **Service order** | The decomposition of an order into one deliverable service. Identified `SO-…`. |
| **Work order** | A unit of field or back-office work (installation, activation, recovery). Identified `WO-…`. |
| **Commercial catalog** | What the customer can buy: offers, prices, bundles, eligibility. |
| **Technical catalog** | What the network must configure to deliver that offer: specs and their attributes. |
| **Spec** | The technical definition a commercial offer version points to. |
| **Attribute** | A field of a spec. The audit checks that provisioning's required attributes exist. |
| **OMS** | Order Management System: decomposes orders, tracks service and work orders, handles fallout. |
| **BPM** | Business Process Management: orchestrates the steps, timers, human tasks and compensations. |
| **Provisioning** | The act of activating the service on the network: terminal registration, beam assignment, QoS and IP profile. |
| **Order-to-activate** | The flow under audit: from order submission to a working, billable service. |
| **Beam** | A footprint of satellite capacity. A satellite order needs a beam with free capacity. |
| **CPE / kit** | Customer premises equipment: dish and modem shipped and installed at the address. |
| **Fallout** | An order that leaves the automated path and waits in a manual queue. |
| **Stuck** | An order with no event for longer than `stuck_after`, in a non-terminal state. |
| **Correlation** | Linking one order's records across four systems that do not share an identifier. |
| **Journey** | The reconstructed timeline of one order across all systems. |
| **Segment** | A slice of a journey marked as work, wait or gap. |
| **Finding** | A rule that fired, with evidence and quantified impact. |
| **Rule** | A declared condition over journeys that produces a finding. |
| **Impact** | Hours and USD attributable to a finding, computed from configurable rates. |
| **Weak link** | A correlation resolved by a time window instead of a declared key. Counted as a gap. |
