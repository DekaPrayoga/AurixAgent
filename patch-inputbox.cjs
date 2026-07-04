const fs = require('fs');

let input = fs.readFileSync('src/cli/InputBox.tsx', 'utf8');

// The issue is in the `onData` or `useKeyboard` event handler in InputBox.tsx.
// We need to change the state update logic to use the functional updater pattern:
// setValue(prev => prev.slice(...) + ch + prev.slice(...))
// setCursor(prev => prev + 1)
// instead of relying on the closure value `value` and `cursor`.

// Let's replace the regular character insertion logic:
const targetInsert = `        setValue(value.slice(0, cursor) + ch + value.slice(cursor));
        setCursor(cursor + ch.length);`;

const injectInsert = `        setValue(prev => {
          const newCursor = typeof cursorRef !== 'undefined' ? cursorRef.current : cursor;
          const nextVal = prev.slice(0, newCursor) + ch + prev.slice(newCursor);
          if (typeof cursorRef !== 'undefined') cursorRef.current = newCursor + ch.length;
          return nextVal;
        });
        setCursor(prev => prev + ch.length);`;

// Let's inject a ref to hold the instantaneous cursor position safely 
// across rapid keypress bursts before render completes.
const targetHooks = `  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);`;

const injectHooks = `  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const cursorRef = React.useRef(0);
  const valueRef = React.useRef('');

  React.useEffect(() => {
    cursorRef.current = cursor;
    valueRef.current = value;
  }, [cursor, value]);`;

// Need to update the backspace logic too
const targetBackspace = `    if (name === 'backspace') {
      evt.preventDefault();
      evt.stopPropagation();
      if (suggestionsVisible || fileSuggestionsVisible) {
        setValue(value.slice(0, -1));
        setCursor(cursor - 1);
        return;
      }
      if (selStart !== -1 && selEnd !== -1) {
        const start = Math.min(selStart, selEnd);
        const end = Math.max(selStart, selEnd);
        setValue(value.slice(0, start) + value.slice(end));
        setCursor(start);
        setSelStart(-1); setSelEnd(-1);
      } else if (cursor > 0) {
        setValue(value.slice(0, cursor - 1) + value.slice(cursor));
        setCursor(cursor - 1);
      }
      return;
    }`;

const injectBackspace = `    if (name === 'backspace') {
      evt.preventDefault();
      evt.stopPropagation();
      
      const curVal = valueRef.current;
      const curPos = cursorRef.current;

      if (suggestionsVisible || fileSuggestionsVisible) {
        setValue(prev => prev.slice(0, -1));
        setCursor(prev => Math.max(0, prev - 1));
        cursorRef.current = Math.max(0, curPos - 1);
        return;
      }
      if (selStart !== -1 && selEnd !== -1) {
        const start = Math.min(selStart, selEnd);
        const end = Math.max(selStart, selEnd);
        setValue(prev => prev.slice(0, start) + prev.slice(end));
        setCursor(start);
        cursorRef.current = start;
        setSelStart(-1); setSelEnd(-1);
      } else if (curPos > 0) {
        setValue(prev => prev.slice(0, curPos - 1) + prev.slice(curPos));
        setCursor(prev => prev - 1);
        cursorRef.current = curPos - 1;
      }
      return;
    }`;


// For normal keys (like typing "d", "a", "h")
const targetTyping = `      if (ch.length === 1 && !escBuf) {
        // ... (selStart logic)
        } else {
          setValue(value.slice(0, cursor) + ch + value.slice(cursor));
          setCursor(cursor + ch.length);
        }
        return;
      }`;
      
const injectTyping = `      if (ch.length === 1 && !escBuf) {
        if (selStart !== -1 && selEnd !== -1) {
          const start = Math.min(selStart, selEnd);
          const end = Math.max(selStart, selEnd);
          setValue(prev => prev.slice(0, start) + ch + prev.slice(end));
          setCursor(start + ch.length);
          cursorRef.current = start + ch.length;
          setSelStart(-1); setSelEnd(-1);
        } else {
          setValue(prev => {
             const c = cursorRef.current;
             return prev.slice(0, c) + ch + prev.slice(c);
          });
          setCursor(prev => prev + ch.length);
          cursorRef.current += ch.length;
        }
        return;
      }`;


// Now we apply these replacements with robust regexes
if (!input.includes("cursorRef")) {
  input = input.replace(targetHooks, injectHooks);
  input = input.replace(targetBackspace, injectBackspace);
  
  // Replace typing block manually since regex for a generic block might fail
  const typeIndex = input.indexOf("if (ch.length === 1 && !escBuf)");
  if (typeIndex !== -1) {
     const nextBrace = input.indexOf("        return;", typeIndex);
     const oldBlock = input.substring(typeIndex, nextBrace + 15);
     input = input.replace(oldBlock, injectTyping);
  }

  fs.writeFileSync('src/cli/InputBox.tsx', input);
  console.log('InputBox patched to fix fast typing bug');
}
