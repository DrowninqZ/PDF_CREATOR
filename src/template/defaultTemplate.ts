/**
 * 默认 A4 模板（示例：人员信息登记表）。
 * 用户可在插件里直接替换成自己的 HTML 模板，占位符统一使用 {{字段名}} 语法。
 */
export const DEFAULT_TEMPLATE = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <style>
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: #ffffff;
      }
      .page {
        width: 210mm;
        min-height: 297mm;
        padding: 16mm 15mm 12mm;
        background: #ffffff;
        font-family: "PingFang SC", "Microsoft YaHei", "Songti SC", sans-serif;
        color: #1f2329;
        font-size: 13px;
      }

      /* 页眉 */
      .head {
        position: relative;
        text-align: center;
        padding-bottom: 5mm;
        border-bottom: 2px solid #1f2329;
        margin-bottom: 7mm;
      }
      .title {
        margin: 0;
        padding-left: 6px;
        font-size: 24px;
        font-weight: 700;
        letter-spacing: 6px;
        color: #1f2329;
      }
      .subtitle {
        margin: 2.5mm 0 0;
        padding-left: 3px;
        font-size: 10px;
        letter-spacing: 3px;
        color: #9aa1ab;
      }
      .no {
        position: absolute;
        right: 0;
        bottom: 2.5mm;
        font-size: 11px;
        letter-spacing: 1px;
        color: #8a9099;
      }

      /* 分组标题 */
      .section {
        display: flex;
        align-items: center;
        margin: 6mm 0 2.5mm;
        font-size: 13px;
        font-weight: 600;
        color: #1f2329;
      }
      .section .bar {
        width: 3px;
        height: 14px;
        margin-right: 7px;
        border-radius: 2px;
        background: #2b5cff;
      }

      /* 表单表格 */
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 13px;
      }
      td {
        height: 11mm;
        padding: 0 3mm;
        border: 1px solid #d5dae1;
        vertical-align: middle;
        overflow-wrap: break-word;
        word-break: normal;
      }
      .label {
        width: 26mm;
        background: #f4f6fa;
        color: #4e5969;
        text-align: center;
        font-weight: 500;
        letter-spacing: 1px;
      }
      .photo {
        width: 34mm;
        background: #f7f8fa;
        color: #a6adb8;
        text-align: center;
        vertical-align: middle;
        font-size: 12px;
        letter-spacing: 2px;
      }
      .tall {
        height: 22mm;
        padding-top: 2.5mm;
        vertical-align: top;
      }

      /* 页脚 */
      .footer {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        margin-top: 14mm;
        padding-top: 4mm;
        border-top: 1px solid #e5e7eb;
        font-size: 12px;
        color: #4e5969;
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="head">
        <h1 class="title">人员信息登记表</h1>
        <p class="subtitle">PERSONNEL INFORMATION FORM</p>
        <div class="no">编号 NO.&nbsp;{{_index}}</div>
      </div>

      <table>
        <tr>
          <td class="label">姓名</td>
          <td>{{姓名}}</td>
          <td class="label">性别</td>
          <td>{{性别}}</td>
          <td class="photo" rowspan="4">照 片</td>
        </tr>
        <tr>
          <td class="label">工号</td>
          <td>{{工号}}</td>
          <td class="label">出生日期</td>
          <td>{{出生日期}}</td>
        </tr>
        <tr>
          <td class="label">部门</td>
          <td>{{部门}}</td>
          <td class="label">职位</td>
          <td>{{职位}}</td>
        </tr>
        <tr>
          <td class="label">入职日期</td>
          <td>{{入职日期}}</td>
          <td class="label">联系电话</td>
          <td>{{联系电话}}</td>
        </tr>
      </table>

      <div class="section"><span class="bar"></span>其他信息</div>
      <table>
        <tr>
          <td class="label">身份证号</td>
          <td colspan="3">{{身份证号}}</td>
        </tr>
        <tr>
          <td class="label">学历</td>
          <td>{{学历}}</td>
          <td class="label">毕业院校</td>
          <td>{{毕业院校}}</td>
        </tr>
        <tr>
          <td class="label">紧急联系人</td>
          <td>{{紧急联系人}}</td>
          <td class="label">紧急联系电话</td>
          <td>{{紧急联系电话}}</td>
        </tr>
        <tr>
          <td class="label">现居住地址</td>
          <td colspan="3">{{现居住地址}}</td>
        </tr>
        <tr>
          <td class="label">备注</td>
          <td class="tall" colspan="3">{{备注}}</td>
        </tr>
      </table>

      <div class="footer">
        <span>填表日期：{{_now}}</span>
        <span>本人签名：____________________</span>
      </div>
    </div>
  </body>
</html>`;