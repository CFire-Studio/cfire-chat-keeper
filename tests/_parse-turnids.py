import sys, json

output = sys.stdin.read()
idx = output.find('{')
if idx >= 0:
    json_str = output[idx:]
    try:
        data = json.loads(json_str)
        print('Total convs:', data.get('totalConvs'))
        print('Doubao msg count:', data.get('doubaoMsgCount'))
        print('Doubao convs:', json.dumps(data.get('doubaoConvs', []), ensure_ascii=False, indent=2))
        print()
        byConv = data.get('byConv', {})
        for convId, info in byConv.items():
            print('Conv:', convId)
            print('  Count:', info['count'])
            turnIds = info['turnIds']
            print('  TurnIds count:', len(turnIds))
            print('  First 5 turnIds:', turnIds[:5])
            print('  Last 5 turnIds:', turnIds[-5:])
            unique = set(turnIds)
            print('  Unique turnIds:', len(unique))
            if len(unique) < len(turnIds):
                print('  *** DUPLICATE TURNIDS DETECTED ***')
            print('  First msg:', json.dumps(info['firstMsg'], ensure_ascii=False))
            print('  Last msg:', json.dumps(info['lastMsg'], ensure_ascii=False))
    except json.JSONDecodeError as e:
        print('JSON parse error:', e)
        print('Raw output:')
        print(output[:5000])
else:
    print('No JSON found in output:')
    print(output[:5000])
