# Frozen presentation seam

Canonical visual reference: qa/minimal-settings-preview/index.html and its style.css/screenshots (all8pages). Use plain black primary/white thin-border secondary10px buttons,20px cards,50px fields, neutral ground, no helper small print. Existing source SVG/provider logos preserved. No arrow/expanding-circle CTA.

Runtime-owned shared files: apps/desktop/src/renderer/console/minimal-ui/controls.tsx and foundation.css. Parent extracts approved foundation CSS; control worker owns controls.tsx, shell.tsx and start.tsx. Other page workers may import this frozen API before its files exist. No runtime import from qa/tasks.

Exports:
- Button: native ButtonHTMLAttributes + busy?:boolean, variant?:primary|secondary|ghost|danger, size?:small. Busy disables; class btn and btn--primary forprimary. No fake status.
- Card: {title:string,children:ReactNode,action?:ReactNode,className?:string,id?:string}, usesarticle.card/header.card__head/h2.card__title/div.card__body. Export Section as same Card for real page conversion.
- Field: {label:string,children:ReactNode|((control)=>ReactNode),error?:string,className?:string}. control={inputId,labelId,describedBy,invalid}. Native label+useId and errors only; no general hint copy. For text native input wrap inputForm; error rolealert.
- Switch: {label:string,checked:boolean,onChange:(boolean)=>void,disabled?:boolean,id?:string,className?:string,data-testid?:string}. Native checkbox role=switch inside label.row + span.switch/input+i; no newstate owner.
- Select: native SelectHTMLAttributes excludingchildren + options:readonly{value:string,label:string,icon?:ReactNode}[]; returnsinputForm wrapper+nativecustomizableselect/button/React.createElement(selectedcontent)/arrow/options. Keepnativeevents/focus; noJSlistbox.
- Status: {children:ReactNode,tone?:ok|warn|danger|muted|off}; plain readable statusspan. Native details/dialogs use shared CSS.

Parent retains ConsoleApp/hook ownership and only switches default presentation imports, passestheme/editor slots and adds lightweight StartModel presentation adapters if needed. Existing contributed navigation/loading/retry/error/confirmation/CAS/history/recording keep semantics. Generic schema config/permissions writes remain current owners. Important destructive confirmation context remains readable; user removed decorative helper copy, not necessary errors/consequences.

Workers must keep original page export names and props. Appearance may add optional children:ReactNode for parent-provided existing theme/editor. Do not add schema/IPC/network/storage. Migrate markup against currentcallbacks and compare actual image toHTML. Preserve original SourceBoard/style-lab code as historical, not defaultskin.
