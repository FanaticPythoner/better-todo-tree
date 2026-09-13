() => {
    const editor = document.querySelector('.monaco-editor');
    const styleKeys = ['color', 'backgroundColor', 'fontStyle', 'fontWeight', 'textDecorationLine'];
    const readStyle = element => {
        const style = getComputedStyle(element);
        return Object.fromEntries(styleKeys.map(key => [key, style[key]]));
    };
    const bounds = element => {
        const rect = element.getBoundingClientRect();
        return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
    };
    const extensionDecoration = element => element.className.includes('TextEditorDecorationType');
    const lines = Array.from(editor.querySelectorAll('.view-line')).map(line => {
        let offset = 0;
        const spans = Array.from(line.querySelectorAll('span')).filter(span => !span.children.length).map(span => {
            const start = offset;
            const text = span.textContent.replaceAll('\u00a0', ' ');
            offset += text.length;
            return {start, end: offset, text, decorated: extensionDecoration(span),
                classes: span.className, style: readStyle(span), rect: bounds(span)};
        });
        return {text: line.textContent.replaceAll('\u00a0', ' '), spans, rect: bounds(line)};
    });
    const overlays = Array.from(editor.querySelectorAll('.view-overlays .cdr')).filter(extensionDecoration)
        .map(element => ({style: readStyle(element), rect: bounds(element), classes: element.className}));
    const gutter = Array.from(editor.querySelectorAll('.glyph-margin-widgets *'))
        .filter(element => getComputedStyle(element).backgroundImage !== 'none')
        .map(element => ({rect: bounds(element), image: getComputedStyle(element).backgroundImage}));
    const workbench = document.querySelector('.monaco-workbench');
    const workbenchStyle = getComputedStyle(workbench);
    return {lines, overlays, gutter, editor: bounds(editor), classes: workbench.className,
        themeForeground: workbenchStyle.getPropertyValue('--vscode-editor-foreground').trim(),
        themeBackground: workbenchStyle.getPropertyValue('--vscode-editor-background').trim(),
        themeSelectionBackground: workbenchStyle.getPropertyValue('--vscode-editor-selectionBackground').trim(),
        ruler: editor.querySelector('canvas.decorationsOverviewRuler').toDataURL(),
        notifications: Array.from(document.querySelectorAll('.notification-list-item')).map(item => item.innerText)};
}
