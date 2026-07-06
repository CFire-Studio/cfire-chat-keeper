import sys, json

output = sys.stdin.read()
idx = output.find('{')
if idx >= 0:
    try:
        data = json.loads(output[idx:])
        if 'result' in data and 'result' in data['result']:
            val = data['result']['result'].get('value')
            if val:
                data = json.loads(val)
        print('Total raw:', data.get('totalRaw'))
        print('Chain raw count:', data.get('chainRawCount'))
        print('Total unique IDs:', data.get('totalUniqueIds'))
        print('Duplicate count:', data.get('duplicateCount'))
        print()
        analyses = data.get('analyses', [])
        print('=== API Responses ===')
        for a in analyses[:20]:
            if 'error' in a:
                print('  [' + str(a.get('index')) + '] error: ' + a['error'])
            else:
                print('  [' + str(a.get('index')) + '] count=' + str(a.get('msgCount')) + ' first=' + str(a.get('firstId')) + ' last=' + str(a.get('lastId')) + ' time=' + str(a.get('capturedAt')))
        if len(analyses) > 20:
            print('  ... and ' + str(len(analyses) - 20) + ' more')
        print()
        dups = data.get('duplicates', {})
        if dups:
            print('=== Duplicate message_ids ===')
            for mid, calls in list(dups.items())[:20]:
                print('  id=' + str(mid) + ' appears in responses: ' + str(calls))
        else:
            print('No duplicate message_ids found')
    except json.JSONDecodeError as e:
        print('JSON parse error:', e)
        print(output[:3000])
else:
    print('No JSON found:')
    print(output[:3000])
