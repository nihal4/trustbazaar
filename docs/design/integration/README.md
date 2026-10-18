# Unit 9: checks across the design documents

`check_documents.py` reads `docs/srs.tex` and `docs/design/0N_*.tex` (flattened, as in the repository) and checks:

- every requirement a unit names exists in the SRS, and every SRS requirement is named by some unit;
- design values DV-n and integration notes I-n are numbered once each, without gaps;
- every consumed event has a publisher, and every port a unit requires is declared by its owner;
- conventions DC-n are defined once.

```bash
python3 docs/design/integration/check_documents.py docs                      # as CI runs it
python3 docs/design/integration/check_documents.py docs db_events.txt labels/ # with the event names the
                                                                              # database writes, and test outputs
```

It writes `document_report.json`, from which `make_tables.py` generates the tables of `09_integration.tex`
(events, ports, the integration register, the security tests still to write, the design values).
