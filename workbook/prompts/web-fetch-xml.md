---
description: web_fetch reads a public XML document as text for the model
workspace: basic
check:
  {
    'areas':
      [
        'packages/tools/src/web-fetch/content.utils.ts',
        'packages/tools/src/web-fetch/request.helper.ts',
        'packages/tools/src/web-fetch/web-fetch.tool.ts',
      ],
    'expect':
      {
        'tools': ['web_fetch'],
        'reply': ['XML_FETCH_OK', 'Tove', 'Jani', 'Reminder'],
        'outcome': 'completed',
      },
    'forbid': { 'transcript': ['Unsupported content type'] },
  }
---

Use web_fetch to read https://www.w3schools.com/xml/note.xml. Do not use another tool.
Read the XML returned by the tool and reply with XML_FETCH_OK followed by the recipient,
sender and heading in that document. If the fetch fails, report its error instead of guessing.
