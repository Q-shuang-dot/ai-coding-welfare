from pathlib import Path
p = Path('gcmp-gateway/gateway.py')
data = p.read_bytes()
print('size:', len(data))
print('has models empty:', b"public['models'] = []" in data)
print('has skills empty:", b'"skills": []' in data)
lines = data.split(b'\n')
print('line2015:', lines[2014][:120])
