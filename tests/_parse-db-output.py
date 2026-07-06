import json, sys
raw = sys.stdin.read().strip()
# The CDP eval returns a JSON-encoded string of the result
# Node's console.log prints it as a JSON string (with escaped quotes)
# So we may need multiple levels of parsing
data = json.loads(raw)
if isinstance(data, str):
    data = json.loads(data)
if isinstance(data, dict) and 'result' in data:
    data = data['result']
if isinstance(data, dict) and 'value' in data:
    data = data['value']
if isinstance(data, str):
    data = json.loads(data)
print('totalMsgs:', data.get('totalMsgs'))
print('doubaoMsgCount:', data.get('doubaoMsgCount'))
print('doubaoConvs:', data.get('doubaoConvs'))
print('first5TurnIds:', [m['turnId'] for m in data.get('doubaoMsgFirst5', [])])
print('last5TurnIds:', [m['turnId'] for m in data.get('doubaoMsgLast5', [])])
