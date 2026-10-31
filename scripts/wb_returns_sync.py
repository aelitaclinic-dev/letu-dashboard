"""Read-only WB returns-to-seller report; publish daily counts, never identifiers."""
import datetime as dt
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

class ReturnError(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def aggregate(report, start, end, fetched, total):
    if not isinstance(report,list) or not isinstance(total,int) or total < len(report):
        raise ReturnError('Unexpected returns report schema')
    if total > len(report):
        raise ReturnError('Returns report needs additional pages; previous snapshot preserved')
    seen, groups = {}, {}
    for row in report:
        identity = (str(row.get('srid') or ''), str(row.get('shkId') or ''))
        if not all(identity):
            raise ReturnError('Returns report is missing item identifiers')
        if identity in seen:
            if seen[identity] != row:
                raise ReturnError('Conflicting return item records')
            continue
        seen[identity] = row
        try:
            date = dt.date.fromisoformat(str(row.get('orderDt'))[:10]).isoformat()
        except ValueError:
            raise ReturnError('Returns report is missing its order date') from None
        # This is the return order date, not proof of receipt by the seller.
        status, kind = row.get('returnStatus'), row.get('returnType')
        if not isinstance(status,str) or not isinstance(kind,str):
            raise ReturnError('Invalid return status/type')
        key=(date,status,kind)
        groups[key]=groups.get(key,0)+1
    return dict(schemaVersion=1,state='ready',fetchedAt=fetched,fromDate=start,toDate=end,
                dateBasis='returnOrderDt',recordsReceived=len(report),uniqueItems=len(seen),
                reportCount=total,rows=[dict(date=k[0],status=k[1],type=k[2],qty=v) for k,v in sorted(groups.items())])

def main():
    token=os.environ.get('WB_IP_API_TOKEN','').strip()
    if not token:
        raise ReturnError('Repository secret WB_IP_API_TOKEN is missing')
    now=dt.datetime.now(dt.timezone(dt.timedelta(hours=3)))
    start=f'{now.year}-01-01'; end=now.date().isoformat()
    query=urllib.parse.urlencode(dict(dateFrom=start,dateTo=end,limit=1000,offset=0))
    request=urllib.request.Request('https://seller-analytics-api.wildberries.ru/api/analytics/v1/item-returns?'+query,
                                  headers={'Authorization':token})
    opener=urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(request,timeout=120) as response:
            payload=json.loads(response.read()) if response.status!=204 else {'count':0,'report':[]}
    except urllib.error.HTTPError as error:
        raise ReturnError('WB returns report HTTP '+str(error.code)) from None
    except (urllib.error.URLError,TimeoutError):
        raise ReturnError('WB returns report network timeout') from None
    result=aggregate(payload['report'],start,end,now.isoformat(timespec='seconds'),payload['count'])
    target=pathlib.Path('wb-returns.json'); temporary=target.with_suffix('.tmp')
    temporary.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');temporary.replace(target)
    print('Returns-to-seller report ready: '+str(result['uniqueItems'])+' items.')

if __name__=='__main__':
    try:
        main()
    except (ReturnError,KeyError,ValueError,TypeError) as error:
        print(str(error) if isinstance(error,ReturnError) else 'Unexpected returns report format',file=sys.stderr)
        sys.exit(1)
